const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function nominatimSearch(query, limit = 10) {
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}` +
    `&format=json&addressdetails=1&extratags=1&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "degoog-maps-plugin/1.0 (https://github.com/fccview/degoog)",
      "Accept-Language": "en",
    },
  });

  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  return res.json();
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export const tab = {
  id: "maps",
  name: "Maps",

  async executeSearch(query, page, context) {
    try {
      const data = await nominatimSearch(query, 10);

      if (!data.length) return { results: [] };

      return {
        results: data.map((place) => {
          const parts = place.display_name.split(", ");
          return {
            title:   parts.slice(0, 2).join(", "),
            url:     `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`,
            snippet: place.display_name,
            source:  "OpenStreetMap",
          };
        }),
      };
    } catch (err) {
      console.error("[maps plugin] executeSearch error:", err);
      return { results: [] };
    }
  },
};

// ── Server-side proxy (avoids CORS + User-Agent issues from the browser) ─────

export const routes = [
  {
    method: "get",
    path: "/search",
    async handler(req) {
      const { searchParams } = new URL(req.url);
      const q     = searchParams.get("q") || "";
      const limit = Math.min(parseInt(searchParams.get("limit") || "15", 10), 20);

      if (!q) return Response.json({ error: "Missing q" }, { status: 400 });

      try {
        const data = await nominatimSearch(q, limit);
        return Response.json(data);
      } catch (err) {
        console.error("[maps plugin] proxy error:", err);
        return Response.json({ error: err.message }, { status: 502 });
      }
    },
  },
];