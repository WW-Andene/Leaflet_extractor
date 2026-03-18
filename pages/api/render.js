import sharp from "sharp";

export const maxDuration = 60;

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body;
  if (!body || !body.tiles || !body.tiles.length) return res.status(400).json({ error: "No tiles" });

  var tileSize = body.tileSize || 256;
  var scale = Math.min(body.scale || 1, 4);
  var scaledTile = Math.round(tileSize * scale);
  var format = body.format === "png" ? "png" : "jpeg";
  var quality = body.quality || 92;
  var cropW = body.cropW || 1;
  var cropH = body.cropH || 1;
  var W = cropW * scaledTile;
  var H = cropH * scaledTile;

  // Safety limits
  if (W > 30000 || H > 30000) return res.status(400).json({ error: "Output too large: " + W + "x" + H + "px (max 30000)" });
  if (body.tiles.length > 10000) return res.status(400).json({ error: "Too many tiles (max 10000)" });

  var patterns = body.patterns || []; // [{pattern, zoom, swapXY}]
  if (body.pattern) patterns = [{ pattern: body.pattern, zoom: 0, swapXY: false }];
  
  var referer = "";
  try {
    var firstPat = (patterns[0] || {}).pattern || "";
    referer = new URL(firstPat.replace(/\{[zxy]\}/g, "0")).origin + "/";
  } catch (e) {}

  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
    Accept: "image/*,*/*",
  };
  if (referer) headers["Referer"] = referer;

  try {
    // Create base image
    var base = sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }
    });

    // Download tiles in parallel batches
    var composites = [];
    var tiles = body.tiles;
    var batchSize = 30;
    var done = 0, failed = 0;

    for (var b = 0; b < tiles.length; b += batchSize) {
      var batch = tiles.slice(b, b + batchSize);
      var results = await Promise.allSettled(batch.map(function(t) {
        var src = patterns[t.srcIdx || 0] || patterns[0] || {};
        var pat = src.pattern || "";
        var z = t.z !== undefined ? t.z : (src.zoom || 0);
        var x = t.x, y = t.y;
        var url;
        if (src.swapXY) url = pat.replace("{z}", z).replace("{x}", y).replace("{y}", x);
        else url = pat.replace("{z}", z).replace("{x}", x).replace("{y}", y);
        return fetchTile(url, headers, scaledTile);
      }));

      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var t = batch[i];
        if (r.status === "fulfilled" && r.value) {
          composites.push({
            input: r.value,
            left: t.gx * scaledTile,
            top: t.gy * scaledTile,
          });
          done++;
        } else {
          failed++;
        }
      }
    }

    if (composites.length === 0) return res.status(500).json({ error: "No tiles loaded" });

    // Composite all tiles — sharp handles this efficiently via libvips
    var output = base.composite(composites);

    if (format === "jpeg") {
      output = output.jpeg({ quality: quality, mozjpeg: true });
    } else {
      output = output.png({ compressionLevel: 6 });
    }

    var buf = await output.toBuffer();

    var ext = format === "jpeg" ? "jpg" : "png";
    res.setHeader("Content-Type", format === "jpeg" ? "image/jpeg" : "image/png");
    res.setHeader("Content-Disposition", "attachment; filename=tilemap_" + W + "x" + H + "." + ext);
    res.setHeader("Content-Length", buf.byteLength);
    return res.send(buf);

  } catch (e) {
    return res.status(500).json({ error: "Render failed: " + e.message });
  }
}

async function fetchTile(url, headers, targetSize) {
  try {
    var r = await fetch(url, { headers: headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    var buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength < 50) return null;
    // Resize to target size (handles scale)
    return await sharp(buf).resize(targetSize, targetSize, { fit: "fill" }).toBuffer();
  } catch (e) { return null; }
}
