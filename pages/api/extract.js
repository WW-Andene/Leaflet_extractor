export const maxDuration = 30;

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  try {
    // Fetch the main page
    const html = await fetchText(url);
    if (!html) {
      return res.status(502).json({ error: "Failed to fetch page" });
    }

    const allPatterns = new Set();
    const allTiles = new Set();

    // Extract from HTML
    const r1 = extractPatterns(html);
    r1.patterns.forEach((p) => allPatterns.add(p));
    r1.tiles.forEach((t) => allTiles.add(t));

    // Find and fetch JS bundles
    const scriptRe = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/g;
    const scripts = [];
    let m;
    while ((m = scriptRe.exec(html)) !== null) {
      let src = m[1];
      try {
        if (src.startsWith("//")) src = "https:" + src;
        else if (src.startsWith("/")) src = new URL(url).origin + src;
        else if (!src.startsWith("http")) src = new URL(src, url).href;
      } catch (e) {
        continue;
      }
      if (
        src.includes(".js") &&
        !src.includes("analytics") &&
        !src.includes("gtag") &&
        !src.includes("adsbygoogle") &&
        !src.includes("facebook") &&
        !src.includes("twitter") &&
        !src.includes("google")
      ) {
        scripts.push(src);
      }
    }

    // Fetch JS bundles (limit to first 12)
    const toFetch = scripts.slice(0, 12);
    const jsResults = await Promise.allSettled(
      toFetch.map((s) => fetchText(s))
    );

    // Extract Leaflet/map config from source
    const mapConfig = extractMapConfig(html);
    for (const result of jsResults) {
      if (result.status === "fulfilled" && result.value) {
        const r2 = extractPatterns(result.value);
        r2.patterns.forEach((p) => allPatterns.add(p));
        r2.tiles.forEach((t) => allTiles.add(t));
        const cfg = extractMapConfig(result.value);
        if (cfg.tileLayerConfigs.length > 0) {
          mapConfig.tileLayerConfigs.push(...cfg.tileLayerConfigs);
        }
        if (cfg.crs) mapConfig.crs = cfg.crs;
        if (cfg.bounds) mapConfig.bounds = cfg.bounds;
      }
    }

    // Derive patterns from tile URLs
    allTiles.forEach((t) => {
      const derived = derivePattern(t);
      if (derived) allPatterns.add(derived);
    });

    res.status(200).json({
      patterns: [...allPatterns],
      tiles: [...allTiles].slice(0, 50),
      scriptsScanned: toFetch.length,
      sourceUrl: url,
      mapConfig: mapConfig,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function fetchText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    return await r.text();
  } catch (e) {
    return null;
  }
}

function extractPatterns(text) {
  const patterns = new Set();
  const tiles = new Set();

  const regexes = [
    // Standard {z}/{x}/{y} tile patterns
    /["'`](https?:\/\/[^"'`\s]{5,300}?\{z\}[^"'`\s]*?\{x\}[^"'`\s]*?\{y\}[^"'`\s]*?)["'`]/gi,
    // Reversed or partial patterns
    /["'`](https?:\/\/[^"'`\s]{5,300}?\{[xyz]\}[^"'`\s]*?\{[xyz]\}[^"'`\s]*?\{[xyz]\}[^"'`\s]*?)["'`]/gi,
    // Direct tile URLs: /z/x/y.ext
    /["'`](https?:\/\/[^"'`\s]{5,200}?\/\d{1,2}\/\d{1,4}\/\d{1,4}\.(png|jpg|jpeg|webp)[^"'`\s]{0,100}?)["'`]/g,
    // L.tileLayer("url")
    /tileLayer\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /L\.tileLayer\s*\(\s*["'`]([^"'`]+)["'`]/g,
    // url: "..." near tile/map keywords
    /(?:tile|map|layer|base|image)(?:Url|_url|URL|Layer|Src|src)\s*[:=]\s*["'`](https?:\/\/[^"'`]{10,300})["'`]/gi,
    // Template literals with ${z} style
    /`(https?:\/\/[^`]{10,300}?\$\{[^}]*[zZ][^}]*\}[^`]*?)`/g,
    // Concatenation patterns: "base" + z + "/" + x + "/" + y
    /["'](https?:\/\/[^"']{10,200})["']\s*\+\s*[^;]{0,50}?[zZ]/g,
    // Relative tile paths
    /["'`](\/[^"'`\s]{5,200}?\/\d{1,2}\/\d{1,4}\/\d{1,4}\.\w{3,4})["'`]/g,
    // CDN/static URLs with image extensions near map context
    /["'`](https?:\/\/[^"'`\s]*?(?:cdn|static|tiles|assets|maps)[^"'`\s]*?\/[^"'`\s]*?\.(png|jpg|webp)[^"'`\s]{0,50}?)["'`]/gi,
    // src attributes with tile-like paths
    /src\s*[:=]\s*["'`](https?:\/\/[^"'`]{5,200}?\/\d+\/\d+\/\d+[^"'`]{0,50}?)["'`]/gi,
    // General /tiles/ path
    /["'`](https?:\/\/[^"'`\s]*?\/tiles\/[^"'`\s]*?)["'`]/gi,
    // Leaflet CRS / bounds patterns (useful context)
    /["'`](https?:\/\/[^"'`\s]*?(?:AkiWorld|wuwa|wuthering)[^"'`\s]*?)["'`]/gi,
  ];

  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const url = m[1];
      if (!url || url.length > 500 || url.length < 10) continue;
      if (url.includes("favicon") || url.includes("icon")) continue;

      if (
        url.includes("{z}") ||
        url.includes("{x}") ||
        url.includes("{y}") ||
        url.includes("${")
      ) {
        patterns.add(url);
      } else if (url.match(/\/\d{1,2}\/\d{1,4}\/\d{1,4}/)) {
        tiles.add(url);
      } else if (url.match(/\.(png|jpg|jpeg|webp)/) && url.match(/tile|map|cdn|static|asset/i)) {
        tiles.add(url);
      } else if (url.match(/AkiWorld|wuwa|wuthering/i)) {
        patterns.add(url);
      }
    }
  }

  return {
    patterns: [...patterns],
    tiles: [...tiles],
  };
}

function derivePattern(tileUrl) {
  const m = tileUrl.match(
    /^(.*?\/?)(\d{1,2})(\/\d{1,4})(\/\d{1,4})(\.\w{3,4})(.*?)$/
  );
  if (m) {
    return m[1] + "{z}" + "/{x}" + "/{y}" + m[5] + m[6];
  }
  return null;
}

function extractMapConfig(text) {
  var config = { tileLayerConfigs: [], crs: null, bounds: null, center: null, zoom: null };

  // L.tileLayer("url", { options }) — capture URL and options block
  var tlRe = /(?:L\.)?tileLayer\s*\(\s*["'`]([^"'`]+)["'`]\s*,?\s*(\{[^}]{0,2000}\})?/gi;
  var m;
  while ((m = tlRe.exec(text)) !== null) {
    var entry = { url: m[1], tms: false, minZoom: null, maxZoom: null, zoomOffset: null, bounds: null };
    if (m[2]) {
      var opts = m[2];
      var tmsM = opts.match(/tms\s*:\s*(true|!0)/i);
      if (tmsM) entry.tms = true;
      var minZ = opts.match(/minZoom\s*:\s*(\d+)/);
      if (minZ) entry.minZoom = parseInt(minZ[1]);
      var maxZ = opts.match(/maxZoom\s*:\s*(\d+)/);
      if (maxZ) entry.maxZoom = parseInt(maxZ[1]);
      var zOff = opts.match(/zoomOffset\s*:\s*([-]?\d+)/);
      if (zOff) entry.zoomOffset = parseInt(zOff[1]);
      var tileSz = opts.match(/tileSize\s*:\s*(\d+)/);
      if (tileSz) entry.tileSize = parseInt(tileSz[1]);
      // bounds: [[lat,lng],[lat,lng]]
      var bM = opts.match(/bounds\s*:\s*\[\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]\s*,\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]\s*\]/);
      if (bM) entry.bounds = [[parseFloat(bM[1]), parseFloat(bM[2])], [parseFloat(bM[3]), parseFloat(bM[4])]];
    }
    config.tileLayerConfigs.push(entry);
  }

  // CRS detection
  var crsRe = /(?:crs|CRS)\s*[:=]\s*(?:L\.CRS\.)?(EPSG\d+|Simple|Earth)/gi;
  var crsM = crsRe.exec(text);
  if (crsM) config.crs = crsM[1];

  // Also check for L.CRS.Simple (common in game maps)
  if (!config.crs && text.match(/CRS\.Simple|crs:\s*["']Simple/i)) config.crs = "Simple";

  // setView or center
  var viewRe = /setView\s*\(\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]\s*,\s*(\d+)/g;
  var viewM = viewRe.exec(text);
  if (viewM) {
    config.center = [parseFloat(viewM[1]), parseFloat(viewM[2])];
    config.zoom = parseInt(viewM[3]);
  }

  // maxBounds
  var maxBRe = /maxBounds\s*:\s*\[\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]\s*,\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]\s*\]/g;
  var maxBM = maxBRe.exec(text);
  if (maxBM) config.bounds = [[parseFloat(maxBM[1]), parseFloat(maxBM[2])], [parseFloat(maxBM[3]), parseFloat(maxBM[4])]];

  // Map dimensions/resolution (common in game maps)
  var dimRe = /(?:mapSize|imageSize|resolution|mapResolution)\s*[:=]\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/gi;
  var dimM = dimRe.exec(text);
  if (dimM) config.mapSize = [parseInt(dimM[1]), parseInt(dimM[2])];

  // Minified tms patterns: tms:!0 or tms:true
  if (!config.tileLayerConfigs.some(function(c) { return c.tms; })) {
    if (text.match(/tms\s*[:=]\s*(?:true|!0)/i)) {
      config.globalTms = true;
    }
  }

  return config;
}
