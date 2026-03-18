export const maxDuration = 30;

export default async function handler(req, res) {
  const { url, sampleTile } = req.query;
  if (sampleTile) return deriveTilePattern(sampleTile, res);
  return deepScanPage(url || "https://wuthering-waves-map.appsample.com/", res);
}

var FORMATS = [
  {
    name: "standard",
    regex: /^(.*\/)(\d{1,2})\/([-]?\d{1,5})\/([-]?\d{1,5})(\.\w{3,5})$/,
    extract: function(m) {
      return { base: m[1], z: parseInt(m[2]), x: parseInt(m[3]), y: parseInt(m[4]), ext: m[5],
        pattern: m[1] + "{z}/{x}/{y}" + m[5] };
    },
  },
  {
    name: "appsample",
    regex: /^(.*\/)(\d{1,2})\/tile-([-]?\d{1,5})_([-]?\d{1,5})(\.\w{3,5})$/,
    extract: function(m) {
      return { base: m[1], z: parseInt(m[2]), x: parseInt(m[3]), y: parseInt(m[4]), ext: m[5],
        pattern: m[1] + "{z}/tile-{x}_{y}" + m[5] };
    },
  },
  {
    name: "underscore",
    regex: /^(.*\/)(\d{1,2})[_-]([-]?\d{1,5})[_-]([-]?\d{1,5})(\.\w{3,5})$/,
    extract: function(m) {
      return { base: m[1], z: parseInt(m[2]), x: parseInt(m[3]), y: parseInt(m[4]), ext: m[5],
        pattern: m[1] + "{z}_{x}_{y}" + m[5] };
    },
  },
];

async function deriveTilePattern(sampleUrl, res) {
  let cleaned = sampleUrl.replace(/[?#].*$/, "").replace(/\{[^}]*\}$/g, "").replace(/\\+$/g, "").trim();

  for (const fmt of FORMATS) {
    const m = cleaned.match(fmt.regex);
    if (m) {
      const info = fmt.extract(m);
      const bounds = await findBounds(info.pattern, info.z, info.x, info.y);
      return res.json({
        success: true, pattern: info.pattern, format: fmt.name,
        detectedZoom: info.z, detectedX: info.x, detectedY: info.y,
        extension: info.ext, bounds, sampleUrl,
      });
    }
  }

  return res.json({ success: false, error: "Could not detect pattern. Supported: z/x/y.ext, z/tile-x_y.ext, z_x_y.ext", cleaned });
}

function build(pattern, z, x, y) {
  return pattern.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

async function findBounds(pattern, zoom, knownX, knownY) {
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  var knownOk = await testTileUrl(build(pattern, zoom, knownX, knownY));
  if (!knownOk) return { ...bounds, error: "Known tile failed", testedUrl: build(pattern, zoom, knownX, knownY) };

  // Binary search helper: find max value where tile exists
  async function searchMax(axis, fixed, start, limit) {
    var lo = start, hi = start + 1;
    // Double until miss
    while (hi <= start + limit) {
      var url = axis === "x" ? build(pattern, zoom, hi, fixed) : build(pattern, zoom, fixed, hi);
      if (await testTileUrl(url)) { lo = hi; hi = lo + Math.max(1, hi - start); }
      else break;
    }
    hi = Math.min(hi, start + limit);
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      var url = axis === "x" ? build(pattern, zoom, mid, fixed) : build(pattern, zoom, fixed, mid);
      if (await testTileUrl(url)) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Binary search: find min value where tile exists (can go negative)
  async function searchMin(axis, fixed, start, limit) {
    var lo = start - 1, hi = start;
    // Double down until miss
    while (lo >= start - limit) {
      var url = axis === "x" ? build(pattern, zoom, lo, fixed) : build(pattern, zoom, fixed, lo);
      if (await testTileUrl(url)) { hi = lo; lo = hi - Math.max(1, start - hi); }
      else break;
    }
    lo = Math.max(lo, start - limit);
    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      var url = axis === "x" ? build(pattern, zoom, mid, fixed) : build(pattern, zoom, fixed, mid);
      if (await testTileUrl(url)) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  bounds.maxX = await searchMax("x", knownY, knownX, 512);
  bounds.minX = await searchMin("x", knownY, knownX, 512);
  bounds.maxY = await searchMax("y", knownX, knownY, 512);
  bounds.minY = await searchMin("y", knownX, knownY, 512);

  // Check other zoom levels
  const zoomInfo = {};
  for (let z = Math.max(0, zoom - 4); z <= zoom + 2; z++) {
    const scale = Math.pow(2, z - zoom);
    const testX = Math.round(knownX * scale);
    const testY = Math.round(knownY * scale);
    if (await testTileUrl(build(pattern, z, testX, testY))) {
      const eMinX = Math.round(bounds.minX * scale);
      const eMaxX = Math.round(bounds.maxX * scale);
      const eMinY = Math.round(bounds.minY * scale);
      const eMaxY = Math.round(bounds.maxY * scale);
      zoomInfo[z] = {
        estimatedMinX: eMinX, estimatedMaxX: eMaxX,
        estimatedMinY: eMinY, estimatedMaxY: eMaxY,
        estimatedTiles: (eMaxX - eMinX + 1) * (eMaxY - eMinY + 1),
        available: true,
      };
    }
  }

  return { ...bounds, zoomInfo };
}

async function testTileUrl(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const ct = r.headers.get("content-type") || "";
      const cl = parseInt(r.headers.get("content-length") || "0");
      return ct.includes("image") || cl > 500;
    }
    return false;
  } catch (e) { return false; }
}

async function deepScanPage(targetUrl, res) {
  const results = { patterns: [], tiles: [], cdnUrls: [], jsScanned: 0 };
  try {
    const html = await fetchText(targetUrl);
    if (!html) return res.json({ ...results, error: "Could not fetch page" });
    scanText(html, results);

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
      if (!src.match(/analytics|gtag|google|facebook|twitter|ads/i)) scripts.push(src);
    }

    const inlineRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = inlineRe.exec(html)) !== null) {
      if (m[1].length > 50 && m[1].length < 500000) scanText(m[1], results);
    }

    for (const scriptUrl of scripts.slice(0, 15)) {
      try {
        const js = await fetchText(scriptUrl);
        if (!js) continue;
        results.jsScanned++;
        scanText(js, results);
        const chunkRe = /["']((?:\/|https?:\/\/)[^"']*?chunk[^"']*?\.js)["']/g;
        while ((m = chunkRe.exec(js)) !== null) {
          let chunkUrl = m[1];
          try { if (chunkUrl.startsWith("/")) chunkUrl = new URL(targetUrl).origin + chunkUrl; if (!scripts.includes(chunkUrl)) scripts.push(chunkUrl); } catch (e) {}
        }
      } catch (e) {}
    }

    results.patterns = [...new Set(results.patterns)];
    results.tiles = [...new Set(results.tiles)].slice(0, 50);
    results.cdnUrls = [...new Set(results.cdnUrls)].slice(0, 30);
    res.json(results);
  } catch (e) { res.status(500).json({ ...results, error: e.message }); }
}

function scanText(text, results) {
  let m;
  // {z}/{x}/{y} patterns
  const tilePatternRe = /["'`]([^"'`\s]{5,500}?(?:\{z\}|\$\{[^}]*z[^}]*\})[^"'`\s]*?(?:\{[xy]\}|\$\{[^}]*[xy][^}]*\})[^"'`\s]*?)["'`]/gi;
  while ((m = tilePatternRe.exec(text)) !== null) results.patterns.push(m[1]);

  // Standard z/x/y.ext
  const numericRe = /["'`](https?:\/\/[^"'`\s]{5,300}?\/\d{1,2}\/[-]?\d{1,5}\/[-]?\d{1,5}\.\w{3,5}[^"'`\s]{0,50}?)["'`]/g;
  while ((m = numericRe.exec(text)) !== null) results.tiles.push(m[1]);

  // Appsample: z/tile-x_y.ext
  const appsampleRe = /["'`](https?:\/\/[^"'`\s]{5,300}?\/\d{1,2}\/tile-[-]?\d{1,5}_[-]?\d{1,5}\.\w{3,5}[^"'`\s]{0,30}?)["'`]/g;
  while ((m = appsampleRe.exec(text)) !== null) results.tiles.push(m[1]);

  // CDN and game-cdn
  const cdnRe = /["'`](https?:\/\/(?:cdn|game-cdn)\.[^"'`\s]{5,300})["'`]/gi;
  while ((m = cdnRe.exec(text)) !== null) results.cdnUrls.push(m[1]);

  // tileLayer
  const leafletRe = /(?:tileLayer|TileLayer)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  while ((m = leafletRe.exec(text)) !== null) results.patterns.push(m[1]);

  // Template literals
  const templateRe = /`(https?:\/\/[^`]{10,500}?\$\{[^`]*\}[^`]*?)`/g;
  while ((m = templateRe.exec(text)) !== null) { if (m[1].match(/tile|map|z|x|y|cdn|layer/i)) results.patterns.push(m[1]); }

  // URL concat
  const concatRe = /["'](https?:\/\/[^"']{10,200})["']\s*\+[^;]{0,200}?["']\/["']\s*\+/g;
  while ((m = concatRe.exec(text)) !== null) results.patterns.push(m[1] + "/{z}/{x}/{y}");

  // map-tiles
  const mapTilesRe = /["'`]([^"'`\s]*map-tiles[^"'`\s]*)["'`]/gi;
  while ((m = mapTilesRe.exec(text)) !== null) results.cdnUrls.push(m[1]);

  // fetch/axios
  const fetchRe = /(?:fetch|axios|get)\s*\(\s*["'`]([^"'`]{10,300}?)["'`]/g;
  while ((m = fetchRe.exec(text)) !== null) { if (m[1].match(/tile|map|cdn|layer|\{z\}|\/\d+\/\d+\/\d+/i)) results.patterns.push(m[1]); }

  // Object properties
  const propRe = /(?:url|src|href|endpoint|baseUrl|tileUrl)\s*:\s*["'`]([^"'`]{10,300})["'`]/gi;
  while ((m = propRe.exec(text)) !== null) { if (m[1].match(/tile|map|cdn|\{z\}|\/\d+\/\d+/i)) results.patterns.push(m[1]); }
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0", Accept: "text/html,application/javascript,*/*" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}
