export const maxDuration = 30;

export default async function handler(req, res) {
  const { url, sampleTile } = req.query;

  // MODE 1: Given a sample tile URL, derive the pattern and find bounds
  if (sampleTile) {
    return deriveTilePattern(sampleTile, res);
  }

  // MODE 2: Deep-scan a map page's JS bundles
  const targetUrl = url || "https://wuthering-waves-map.appsample.com/";
  return deepScanPage(targetUrl, res);
}

async function deriveTilePattern(sampleUrl, res) {
  // Try to detect z/x/y from the URL
  const patterns = [
    /^(.*?)(\d{1,2})\/(\d{1,5})\/(\d{1,5})(\.\w{3,5})(.*)$/,
    /^(.*?)(\d{1,2})[_-](\d{1,5})[_-](\d{1,5})(\.\w{3,5})(.*)$/,
  ];

  for (const re of patterns) {
    const m = sampleUrl.match(re);
    if (m) {
      const [_, base, z, x, y, ext, rest] = m;
      const pattern = base + "{z}/{x}/{y}" + ext + rest;
      const zNum = parseInt(z);

      // Probe to find max bounds at this zoom
      const bounds = await findBounds(pattern, zNum);

      return res.json({
        success: true,
        pattern,
        detectedZoom: zNum,
        detectedX: parseInt(x),
        detectedY: parseInt(y),
        extension: ext,
        bounds,
        sampleUrl,
      });
    }
  }

  return res.json({ success: false, error: "Could not detect z/x/y pattern from URL" });
}

async function findBounds(pattern, zoom) {
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  // Binary search for max X
  let lo = 0, hi = 256;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const url = pattern.replace("{z}", zoom).replace("{x}", mid).replace("{y}", 0);
    const ok = await testTileUrl(url);
    if (ok) lo = mid; else hi = mid - 1;
  }
  bounds.maxX = lo;

  // Binary search for max Y
  lo = 0; hi = 256;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const url = pattern.replace("{z}", zoom).replace("{x}", 0).replace("{y}", mid);
    const ok = await testTileUrl(url);
    if (ok) lo = mid; else hi = mid - 1;
  }
  bounds.maxY = lo;

  // Also check other zoom levels
  const zoomInfo = {};
  for (let z = Math.max(0, zoom - 3); z <= zoom + 3; z++) {
    const testUrl = pattern.replace("{z}", z).replace("{x}", 0).replace("{y}", 0);
    const ok = await testTileUrl(testUrl);
    if (ok) {
      // Quick bounds estimate: at each zoom, tiles double
      const scale = Math.pow(2, z - zoom);
      zoomInfo[z] = {
        estimatedMaxX: Math.max(0, Math.round(bounds.maxX * scale)),
        estimatedMaxY: Math.max(0, Math.round(bounds.maxY * scale)),
        available: true,
      };
    }
  }

  return { ...bounds, zoomInfo };
}

async function testTileUrl(url) {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const ct = r.headers.get("content-type") || "";
      const cl = parseInt(r.headers.get("content-length") || "0");
      return ct.includes("image") || cl > 500;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function deepScanPage(targetUrl, res) {
  const results = { patterns: [], tiles: [], cdnUrls: [], jsScanned: 0 };

  try {
    // Fetch main page
    const html = await fetchText(targetUrl);
    if (!html) return res.json({ ...results, error: "Could not fetch page" });

    scanText(html, results);

    // Find ALL script tags
    const scriptRe = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const scripts = [];
    let m;
    while ((m = scriptRe.exec(html)) !== null) {
      let src = m[1];
      try {
        if (src.startsWith("//")) src = "https:" + src;
        else if (src.startsWith("/")) src = new URL(targetUrl).origin + src;
        else if (!src.startsWith("http")) src = new URL(src, targetUrl).href;
      } catch (e) { continue; }
      if (!src.match(/analytics|gtag|google|facebook|twitter|ads/i)) {
        scripts.push(src);
      }
    }

    // Also find inline scripts
    const inlineRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = inlineRe.exec(html)) !== null) {
      if (m[1].length > 50 && m[1].length < 500000) {
        scanText(m[1], results);
      }
    }

    // Fetch all JS bundles
    for (const scriptUrl of scripts.slice(0, 15)) {
      try {
        const js = await fetchText(scriptUrl);
        if (!js) continue;
        results.jsScanned++;
        scanText(js, results);

        // Look for dynamic imports / chunk references
        const chunkRe = /["']((?:\/|https?:\/\/)[^"']*?chunk[^"']*?\.js)["']/g;
        while ((m = chunkRe.exec(js)) !== null) {
          let chunkUrl = m[1];
          try {
            if (chunkUrl.startsWith("/")) chunkUrl = new URL(targetUrl).origin + chunkUrl;
            if (!scripts.includes(chunkUrl)) scripts.push(chunkUrl);
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Deduplicate
    results.patterns = [...new Set(results.patterns)];
    results.tiles = [...new Set(results.tiles)].slice(0, 50);
    results.cdnUrls = [...new Set(results.cdnUrls)].slice(0, 30);

    res.json(results);
  } catch (e) {
    res.status(500).json({ ...results, error: e.message });
  }
}

function scanText(text, results) {
  // 1. Standard tile patterns with {z}/{x}/{y}
  const tilePatternRe = /["'`]([^"'`\s]{5,500}?(?:\{z\}|\$\{[^}]*z[^}]*\})[^"'`\s]*?(?:\{[xy]\}|\$\{[^}]*[xy][^}]*\})[^"'`\s]*?)["'`]/gi;
  let m;
  while ((m = tilePatternRe.exec(text)) !== null) results.patterns.push(m[1]);

  // 2. Direct tile URLs with numeric z/x/y
  const numericTileRe = /["'`](https?:\/\/[^"'`\s]{5,300}?\/\d{1,2}\/\d{1,5}\/\d{1,5}\.\w{3,5}[^"'`\s]{0,50}?)["'`]/g;
  while ((m = numericTileRe.exec(text)) !== null) results.tiles.push(m[1]);

  // 3. CDN URLs (especially cdn.th.gl)
  const cdnRe = /["'`](https?:\/\/cdn\.[^"'`\s]{5,300})["'`]/gi;
  while ((m = cdnRe.exec(text)) !== null) results.cdnUrls.push(m[1]);

  // 4. L.tileLayer("url")
  const leafletRe = /(?:tileLayer|TileLayer)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  while ((m = leafletRe.exec(text)) !== null) results.patterns.push(m[1]);

  // 5. Template literals with interpolation near tile/map context
  const templateRe = /`(https?:\/\/[^`]{10,500}?\$\{[^`]*\}[^`]*?)`/g;
  while ((m = templateRe.exec(text)) !== null) {
    if (m[1].match(/tile|map|z|x|y|cdn|layer/i)) results.patterns.push(m[1]);
  }

  // 6. URL construction: baseUrl + "/" + z + "/" + x + "/" + y
  const concatRe = /["'](https?:\/\/[^"']{10,200})["']\s*\+[^;]{0,200}?["']\/["']\s*\+/g;
  while ((m = concatRe.exec(text)) !== null) results.patterns.push(m[1] + "/{z}/{x}/{y}");

  // 7. Anything with /map-tiles/
  const mapTilesRe = /["'`]([^"'`\s]*map-tiles[^"'`\s]*)["'`]/gi;
  while ((m = mapTilesRe.exec(text)) !== null) results.cdnUrls.push(m[1]);

  // 8. fetch() or axios calls with tile-like URLs
  const fetchRe = /(?:fetch|axios|get)\s*\(\s*["'`]([^"'`]{10,300}?)["'`]/g;
  while ((m = fetchRe.exec(text)) !== null) {
    if (m[1].match(/tile|map|cdn|layer|\{z\}|\/\d+\/\d+\/\d+/i)) results.patterns.push(m[1]);
  }

  // 9. Object properties like { url: "...", tileSize: 256 }
  const propRe = /(?:url|src|href|endpoint|baseUrl|tileUrl)\s*:\s*["'`]([^"'`]{10,300})["'`]/gi;
  while ((m = propRe.exec(text)) !== null) {
    if (m[1].match(/tile|map|cdn|\{z\}|\/\d+\/\d+/i)) results.patterns.push(m[1]);
  }
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
        Accept: "text/html,application/javascript,*/*",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}
