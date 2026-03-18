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

    for (const result of jsResults) {
      if (result.status === "fulfilled" && result.value) {
        const r2 = extractPatterns(result.value);
        r2.patterns.forEach((p) => allPatterns.add(p));
        r2.tiles.forEach((t) => allTiles.add(t));
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
