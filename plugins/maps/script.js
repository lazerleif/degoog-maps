(function () {
  // ── Leaflet loader ──────────────────────────────────────────────────────────

  let leafletLoaded = false;
  let leafletPromise = null;

  function loadLeaflet() {
    if (leafletLoaded) return Promise.resolve();
    if (leafletPromise) return leafletPromise;

    leafletPromise = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => { leafletLoaded = true; resolve(); };
      document.head.appendChild(script);
    });

    return leafletPromise;
  }

  // ── Sidebar hide/show ───────────────────────────────────────────────────────

  function hideSidebar() {
    document.body.classList.add("maps-tab-active");
  }

  function showSidebar() {
    document.body.classList.remove("maps-tab-active");
  }

  // ── XSS escape ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  let mapInstance      = null;
  let lastRenderedQuery = null;
  let activeRequest    = null;
  const queryCache     = new Map();

  function destroyMap() {
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
    const existing = document.getElementById("maps-plugin-container");
    if (existing) existing.remove();
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    lastRenderedQuery = null;
    showSidebar();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getParam(key) {
    return new URLSearchParams(window.location.search).get(key) || "";
  }

  function isMapsTab() {
    const type = getParam("type");
    const tab  = getParam("tab");
    return type === "tab:maps" || tab === "maps";
  }

  function findInsertionPoint() {
    return (
      document.getElementById("results-list") ||
      document.querySelector(".results-main") ||
      document.querySelector(".results-page") ||
      document.querySelector("main")
    );
  }

  function containerInDOM() {
    const el = document.getElementById("maps-plugin-container");
    return el && document.body.contains(el);
  }

  function fixMapSize() {
    const container = document.getElementById("maps-plugin-container");
    const mapEl     = document.getElementById("maps-plugin-map");
    if (!container || !mapEl) return;

    const w = container.offsetWidth;
    if (w > 0) {
      mapEl.style.width  = w + "px";
      mapEl.style.height = "420px";
    }

    if (mapInstance) mapInstance.invalidateSize(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  async function renderMap(query) {
    if (query === lastRenderedQuery) return;

    const anchor = findInsertionPoint();
    if (!anchor) {
      setTimeout(() => renderMap(query), 200);
      return;
    }

    lastRenderedQuery = query;
    hideSidebar();

    // Abort any in-flight request for a previous query
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }

    // Clean up previous map
    const existing = document.getElementById("maps-plugin-container");
    if (existing) existing.remove();
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }

    // Build container
    const container = document.createElement("div");
    container.id = "maps-plugin-container";
    container.style.display      = "block";
    container.style.width        = "100%";
    container.style.marginBottom = "1.5rem";

    const mapEl = document.createElement("div");
    mapEl.id = "maps-plugin-map";
    mapEl.style.height = "420px";
    mapEl.style.width  = "100%";

    // Loading state
    mapEl.innerHTML = '<p class="maps-loading">Loading map…</p>';
    container.appendChild(mapEl);

    anchor.parentNode.insertBefore(container, anchor);

    // Load Leaflet in parallel with the API fetch
    const leafletReady = loadLeaflet();

    // Fetch places — use cache if available
    let places = queryCache.get(query) || null;

    if (!places) {
      try {
        activeRequest = new AbortController();
        const res = await fetch(
          `/api/plugin/maps/search?q=${encodeURIComponent(query)}&limit=15`,
          { signal: activeRequest.signal }
        );
        activeRequest = null;

        if (!res.ok) throw new Error(`API error ${res.status}`);
        places = await res.json();

        // Store in cache (cap at 30 entries)
        if (queryCache.size >= 30) {
          queryCache.delete(queryCache.keys().next().value);
        }
        queryCache.set(query, places);

      } catch (err) {
        if (err.name === "AbortError") return; // user navigated away
        mapEl.innerHTML = '<p class="maps-no-results">Could not load map data.</p>';
        return;
      }
    }

    if (!Array.isArray(places) || !places.length) {
      mapEl.innerHTML = '<p class="maps-no-results">No places found.</p>';
      return;
    }

    // Wait for Leaflet before rendering
    await leafletReady;
    const L = window.L;

    // Clear loading message
    mapEl.innerHTML = "";

    const map = L.map("maps-plugin-map", { scrollWheelZoom: true });
    mapInstance = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const bounds = [];

    places.forEach((place) => {
      const lat = parseFloat(place.lat);
      const lon = parseFloat(place.lon);
      if (isNaN(lat) || isNaN(lon)) return;

      bounds.push([lat, lon]);

      const name   = escapeHtml(place.display_name.split(", ").slice(0, 2).join(", "));
      const osmUrl = `https://www.openstreetmap.org/${encodeURIComponent(place.osm_type)}/${encodeURIComponent(place.osm_id)}`;

      L.marker([lat, lon])
        .addTo(map)
        .bindPopup(
          `<strong>${name}</strong><br>` +
          `<a href="${osmUrl}" target="_blank" rel="noopener">View on OpenStreetMap ↗</a>`
        );
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    setTimeout(() => fixMapSize(), 50);
    setTimeout(() => fixMapSize(), 200);
    setTimeout(() => fixMapSize(), 600);
  }

  // ── Check & react ───────────────────────────────────────────────────────────

  function check() {
    if (isMapsTab()) {
      const q = getParam("q");
      if (q) renderMap(q);
    } else {
      destroyMap();
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────

  setTimeout(check, 100);

  const _push = history.pushState.bind(history);
  history.pushState = function (...args) {
    _push(...args);
    setTimeout(check, 150);
  };
  window.addEventListener("popstate", () => setTimeout(check, 150));

  // Resize handler
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMapsTab()) return;
      if (containerInDOM()) {
        fixMapSize();
      } else {
        lastRenderedQuery = null;
        check();
      }
    }, 150);
  });

  // MutationObserver — throttled to avoid CPU spam
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      if (!isMapsTab()) return;
      if (containerInDOM()) return;
      const q = getParam("q");
      if (q) { lastRenderedQuery = null; renderMap(q); }
    }, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
