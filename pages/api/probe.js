export default async function handler(req, res) {
  const { mapId, pageUrl } = req.query;
  const map = mapId || "AkiWorld_WP";
  const results = { working: [], jsFindings: [], errors: [] };

  // ============================================
  // STRATEGY 1: Grep JS bundles for tile URLs
  // ============================================
  const pagesToScan = [
    pageUrl || "https://wuthering.th.gl/maps/Overworld",
    "https://wuthering.th.gl/",
  ];

  for (const page of pagesToScan) {
    try {
      const html = await fetchText(page);
      if (!html) continue;

      // Find JS bundle URLs
      const scriptRe = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/g;
      let m;
      const scripts = [];
      while ((m = scriptRe.exec(html)) !== null) {
        let src = m[1];
        if (src.startsWith("//")) src = "https:" + src;
        else if (src.startsWith("/")) src = new URL(page).origin + src;
        else if (!src.startsWith("http")) src = new URL(src, page).href;
        if (!src.includes("analytics") && !src.includes("gtag") && !src.includes("google") && !src.includes("facebook")) {
          scripts.push(src);
        }
      }

      // Fetch each JS bundle and search for tile patterns
      for (const scriptUrl of scripts.slice(0, 15)) {
        try {
          const js = await fetchText(scriptUrl);
          if (!js) continue;

          // Search for cdn.th.gl URLs
          const cdnRegex = /["'`](https?:\/\/cdn\.th\.gl[^"'`\s]{5,300})["'`]/g;
          let cm;
          while ((cm = cdnRegex.exec(js)) !== null) {
            results.jsFindings.push({ source: scriptUrl.split("/").pop(), url: cm[1] });
          }

          // Search for any tile-pattern-like URLs
          const tileRegex = /["'`]([^"'`\s]{5,300}(?:\{z\}|\{x\}|\{y\}|\$\{z\}|\$\{x\}|\$\{y\})[^"'`\s]{0,200})["'`]/gi;
          let tm;
          while ((tm = tileRegex.exec(js)) !== null) {
            results.jsFindings.push({ source: scriptUrl.split("/").pop(), url: tm[1] });
          }

          // Search for map-tiles path
          const mapTilesRegex = /["'`]([^"'`\s]*map-tiles[^"'`\s]*)["'`]/gi;
          let mm;
          while ((mm = mapTilesRegex.exec(js)) !== null) {
            results.jsFindings.push({ source: scriptUrl.split("/").pop(), url: mm[1] });
          }

          // Search for the specific mapId
          if (js.includes(map)) {
            // Find URLs near the mapId mention
            const idx = js.indexOf(map);
            const context = js.substring(Math.max(0, idx - 500), Math.min(js.length, idx + 500));
            const contextUrls = /["'`](https?:\/\/[^"'`\s]{10,300})["'`]/g;
            let cu;
            while ((cu = contextUrls.exec(context)) !== null) {
              results.jsFindings.push({ source: "context_near_" + map, url: cu[1] });
            }
            // Also grab template literals
            const templateRegex = /`([^`]{5,500}?)`/g;
            let tl;
            while ((tl = templateRegex.exec(context)) !== null) {
              if (tl[1].includes("$") || tl[1].includes("http")) {
                results.jsFindings.push({ source: "template_near_" + map, url: tl[1] });
              }
            }
          }

        } catch (e) {
          results.errors.push("JS fetch error: " + scriptUrl.split("/").pop() + " - " + e.message);
        }
      }
    } catch (e) {
      results.errors.push("Page fetch error: " + e.message);
    }
  }

  // ============================================
  // STRATEGY 2: Brute-force tile URL patterns
  // ============================================
  const cdnBases = [
    "https://cdn.th.gl/wuthering-waves/map-tiles",
    "https://cdn.th.gl/wuthering-waves/tiles",
    "https://cdn.th.gl/wuthering-waves",
    "https://cdn.th.gl/map-tiles",
    "https://cdn.th.gl/tiles",
    "https://wuthering.th.gl/tiles",
    "https://wuthering.th.gl/map-tiles",
    "https://wuthering.th.gl/assets/tiles",
    "https://wuthering.th.gl/assets/map-tiles",
    "https://wuthering.th.gl/api/tiles",
  ];

  const extensions = ["webp", "png", "jpg", "jpeg"];

  const pathPatterns = [
    "/{map}/{z}/{x}/{y}",
    "/{map}/tiles/{z}/{x}/{y}",
    "/{map}/{z}/{x}_{y}",
    "/{map}/{z}/{y}/{x}",
    "/{map}/{z}-{x}-{y}",
    "/{map}/{z}_{x}_{y}",
    "/{map}/tile/{z}/{x}/{y}",
    "/{map}/tile_{z}_{x}_{y}",
    "/{map}/z{z}/{x}/{y}",
    "/{map}/z{z}/x{x}/y{y}",
    "/{map}/level{z}/{x}/{y}",
    "/{map}/{z}/tile_{x}_{y}",
    "/{map}/{z}/row{y}/col{x}",
    "/{map}/{z}/r{y}_c{x}",
    "/{z}/{x}/{y}",
    "/tiles/{z}/{x}/{y}",
    "/{map}/{z}/{x}/{y}@1x",
    "/{map}/{z}/{x}/{y}@2x",
    "/{map}/map/{z}/{x}/{y}",
    "/{z}/{map}/{x}/{y}",
    "/tile/{map}/{z}/{x}/{y}",
  ];

  const testCoords = [
    { z: 0, x: 0, y: 0 },
    { z: 1, x: 0, y: 0 },
    { z: 1, x: 1, y: 1 },
    { z: 2, x: 0, y: 0 },
    { z: 2, x: 1, y: 1 },
    { z: 2, x: 2, y: 2 },
    { z: 3, x: 0, y: 0 },
    { z: 3, x: 2, y: 2 },
    { z: 3, x: 4, y: 4 },
    { z: 4, x: 0, y: 0 },
    { z: 4, x: 4, y: 4 },
    { z: 4, x: 8, y: 8 },
    { z: 5, x: 0, y: 0 },
    { z: 5, x: 8, y: 8 },
    { z: 5, x: 16, y: 16 },
    { z: 6, x: 0, y: 0 },
    { z: 6, x: 16, y: 16 },
    { z: 7, x: 0, y: 0 },
  ];

  // Generate all candidate URLs
  let totalTested = 0;
  const MAX_TESTS = 500;

  outerLoop:
  for (const base of cdnBases) {
    for (const pathPattern of pathPatterns) {
      for (const ext of extensions) {
        if (totalTested >= MAX_TESTS) break outerLoop;

        const fullPattern = base + pathPattern + "." + ext;
        const patternWithMap = fullPattern.replace(/\{map\}/g, map);

        for (const { z, x, y } of testCoords) {
          if (totalTested >= MAX_TESTS) break outerLoop;

          const testUrl = patternWithMap
            .replace("{z}", z)
            .replace("{x}", x)
            .replace("{y}", y);

          totalTested++;

          try {
            const r = await fetch(testUrl, {
              method: "HEAD",
              headers: { "User-Agent": "Mozilla/5.0" },
              signal: AbortSignal.timeout(4000),
            });

            if (r.ok) {
              const ct = r.headers.get("content-type") || "";
              const cl = r.headers.get("content-length") || "?";
              if (ct.includes("image") || parseInt(cl) > 1000) {
                results.working.push({
                  pattern: patternWithMap.replace(String(z), "{z}").replace("/" + x + "/", "/{x}/").replace("/" + y + ".", "/{y}.").replace("_" + x + "_", "_{x}_").replace("_" + y + ".", "_{y}.").replace("-" + x + "-", "-{x}-").replace("-" + y + ".", "-{y}."),
                  testedUrl: testUrl,
                  status: r.status,
                  contentType: ct,
                  contentLength: cl,
                  z, x, y,
                });
                // Found one! But keep testing other bases to find alternatives
                break;
              }
            }
          } catch (e) {
            // Skip timeouts
          }
        }
      }
    }
  }

  // Deduplicate jsFindings
  const seenUrls = new Set();
  results.jsFindings = results.jsFindings.filter(f => {
    if (seenUrls.has(f.url)) return false;
    seenUrls.add(f.url);
    return true;
  });

  res.json({
    mapId: map,
    totalTested,
    working: results.working,
    jsFindings: results.jsFindings,
    errors: results.errors.slice(0, 5),
  });
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}
