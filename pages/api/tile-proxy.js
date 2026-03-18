export default async function handler(req, res) {
  const { url, check } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  // Derive Referer from tile URL origin (some CDNs check it)
  var referer = "";
  try { referer = new URL(url).origin + "/"; } catch(e) {}

  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (referer) headers["Referer"] = referer;

  // Check mode: return metadata only
  if (check === "1") {
    try {
      const response = await fetch(url, { headers: headers, signal: AbortSignal.timeout(5000) });
      if (!response.ok) return res.json({ ok: false, status: response.status, size: 0 });
      const buf = Buffer.from(await response.arrayBuffer());
      const ct = response.headers.get("content-type") || "";
      var isImage = ct.includes("image") || ct.includes("octet");
      return res.json({ ok: isImage, status: 200, size: buf.byteLength, contentType: ct });
    } catch (e) { return res.json({ ok: false, error: e.message, size: 0 }); }
  }

  // Fetch tile with retries
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: headers, signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        if (attempt < 2) continue;
        return res.status(response.status).json({ error: "Tile fetch failed: " + response.status });
      }

      const contentType = response.headers.get("content-type") || "image/webp";
      const buffer = Buffer.from(await response.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(buffer);
    } catch (e) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return res.status(500).json({ error: e.message });
    }
  }
}
