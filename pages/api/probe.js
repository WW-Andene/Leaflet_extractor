export default async function handler(req, res) {
  const { base, mapId } = req.query;

  // If a specific tile URL is given, just test it
  if (req.query.url) {
    try {
      const r = await fetch(req.query.url, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      return res.json({ url: req.query.url, status: r.status, ok: r.ok, type: r.headers.get("content-type") });
    } catch (e) {
      return res.json({ url: req.query.url, status: 0, ok: false, error: e.message });
    }
  }

  // Auto-probe: given a CDN base and mapId, try common tile URL structures
  const cdnBase = base || "https://cdn.th.gl/wuthering-waves/map-tiles";
  const map = mapId || "AkiWorld_WP";

  const candidates = [
    `${cdnBase}/${map}/{z}/{x}/{y}.webp`,
    `${cdnBase}/${map}/{z}/{x}/{y}.png`,
    `${cdnBase}/${map}/{z}/{x}/{y}.jpg`,
    `${cdnBase}/${map}/tiles/{z}/{x}/{y}.webp`,
    `${cdnBase}/${map}/tiles/{z}/{x}/{y}.png`,
    `${cdnBase}/${map}/tiles/{z}/{x}/{y}.jpg`,
    `${cdnBase}/${map}/{z}/{x}_{y}.webp`,
    `${cdnBase}/${map}/{z}/{x}_{y}.png`,
    `${cdnBase}/${map}/{z}-{x}-{y}.webp`,
    `${cdnBase}/${map}/{z}-{x}-{y}.png`,
  ];

  // Test zoom levels 1-4, coords 0,0 and 1,1
  const testCoords = [
    { z: 2, x: 0, y: 0 },
    { z: 2, x: 1, y: 1 },
    { z: 3, x: 0, y: 0 },
    { z: 3, x: 2, y: 2 },
    { z: 1, x: 0, y: 0 },
    { z: 4, x: 4, y: 4 },
  ];

  const results = [];

  for (const pattern of candidates) {
    let found = false;
    for (const { z, x, y } of testCoords) {
      const url = pattern.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      try {
        const r = await fetch(url, {
          method: "HEAD",
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const ct = r.headers.get("content-type") || "";
          if (ct.includes("image")) {
            results.push({
              pattern,
              testedUrl: url,
              status: r.status,
              contentType: ct,
              z, x, y,
            });
            found = true;
            break;
          }
        }
      } catch (e) {
        // Skip
      }
    }
    // Early exit if we found a working pattern
    if (found) break;
  }

  res.json({
    cdnBase,
    mapId: map,
    candidatesTested: candidates.length,
    working: results,
  });
}
