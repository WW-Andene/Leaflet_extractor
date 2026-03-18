import sharp from "sharp";

export const maxDuration = 120;

// Disable default body parser to handle multipart FormData
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // Parse multipart form data manually (no external dep needed)
    var bufs = [];
    for await (var chunk of req) bufs.push(chunk);
    var body = Buffer.concat(bufs);

    // Extract boundary from content-type
    var ct = req.headers["content-type"] || "";
    var boundaryMatch = ct.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "No boundary in content-type" });
    var boundary = "--" + boundaryMatch[1];

    // Split into parts
    var parts = [];
    var configJson = null;
    var bodyStr = body.toString("binary");
    var sections = bodyStr.split(boundary).filter(function(s) { return s.length > 4 && s !== "--\r\n"; });

    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var headerEnd = section.indexOf("\r\n\r\n");
      if (headerEnd === -1) continue;
      var headers = section.substring(0, headerEnd);
      var content = section.substring(headerEnd + 4);
      // Remove trailing \r\n
      if (content.endsWith("\r\n")) content = content.substring(0, content.length - 2);

      var nameMatch = headers.match(/name="([^"]+)"/);
      if (!nameMatch) continue;
      var name = nameMatch[1];

      if (name === "config") {
        configJson = JSON.parse(content);
      } else if (name.startsWith("strip_")) {
        var stripIdx = parseInt(name.split("_")[1]);
        // Convert binary string back to Buffer
        parts.push({ idx: stripIdx, buf: Buffer.from(content, "binary") });
      }
    }

    if (!configJson || parts.length === 0) {
      return res.status(400).json({ error: "Missing config or strips" });
    }

    parts.sort(function(a, b) { return a.idx - b.idx; });

    var W = configJson.width;
    var H = configJson.height;
    var format = configJson.format === "png" ? "png" : "jpeg";
    var quality = configJson.quality || 92;

    // Safety limits
    if (W > 50000 || H > 50000) return res.status(400).json({ error: "Output too large: " + W + "x" + H });

    // Get dimensions of each strip
    var composites = [];
    var yOffset = 0;
    for (var j = 0; j < parts.length; j++) {
      var meta = await sharp(parts[j].buf).metadata();
      composites.push({
        input: parts[j].buf,
        left: 0,
        top: yOffset,
      });
      yOffset += meta.height;
    }

    // Create base and composite strips
    var base = sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }
    }).composite(composites);

    var output;
    if (format === "jpeg") {
      output = await base.jpeg({ quality: quality, mozjpeg: true }).toBuffer();
    } else {
      output = await base.png({ compressionLevel: 6 }).toBuffer();
    }

    var ext = format === "jpeg" ? "jpg" : "png";
    res.setHeader("Content-Type", format === "jpeg" ? "image/jpeg" : "image/png");
    res.setHeader("Content-Disposition", "attachment; filename=tilemap_" + W + "x" + H + "." + ext);
    res.setHeader("Content-Length", output.byteLength);
    return res.send(output);

  } catch (e) {
    return res.status(500).json({ error: "Stitch failed: " + e.message });
  }
}
