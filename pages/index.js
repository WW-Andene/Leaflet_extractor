import { useState } from "react";

const PRESETS = [
  { label: "Overworld", url: "https://wuthering.gg/map" },
  { label: "Rinascita", url: "https://wuthering.gg/map/rinascita" },
  { label: "Tethys Deep", url: "https://wuthering.gg/map/tethys-deep" },
  { label: "Lahai-Roi", url: "https://wuthering.gg/map/lahai-roi" },
  { label: "Frostlands", url: "https://wuthering.gg/map/roya-frostlands" },
  { label: "Appsample", url: "https://wuthering-waves-map.appsample.com/" },
  { label: "TH.GL", url: "https://wuthering.th.gl/maps/Overworld" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("extract");

  // Stitch state
  const [sampleTileUrl, setSampleTileUrl] = useState("");
  const [tilePattern, setTilePattern] = useState("");
  const [zoom, setZoom] = useState(3);
  const [minX, setMinX] = useState(0);
  const [maxX, setMaxX] = useState(7);
  const [minY, setMinY] = useState(0);
  const [maxY, setMaxY] = useState(7);
  const [tileSize, setTileSize] = useState(256);
  const [stitchStatus, setStitchStatus] = useState("");
  const [stitchProgress, setStitchProgress] = useState(0);
  const [stitching, setStitching] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [useProxy, setUseProxy] = useState(true);
  const [flipY, setFlipY] = useState(false);
  const [flipX, setFlipX] = useState(false);
  const [swapXY, setSwapXY] = useState(false);
  const [gridPreview, setGridPreview] = useState(null);
  const [probeImg, setProbeImg] = useState(null);
  const [failedTiles, setFailedTiles] = useState([]);
  const [canvasCtx, setCanvasCtx] = useState(null);
  const [canvasEl, setCanvasEl] = useState(null);
  const [probing, setProbing] = useState(false);
  const [probeResults, setProbeResults] = useState(null);

  // --- EXTRACT ---
  async function extract() {
    if (!url) return;
    setLoading(true); setResults(null);
    setStatus("Fetching & scanning JS bundles...");
    try {
      const r = await fetch("/api/extract?url=" + encodeURIComponent(url));
      const d = await r.json();
      if (d.error) setStatus("Error: " + d.error);
      else {
        setStatus("Found " + d.patterns.length + " pattern(s), " + d.tiles.length + " tile(s)");
        setResults(d);
        if (d.patterns.length > 0) setTilePattern(d.patterns[0]);
      }
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  }

  // --- PASTE ONE TILE URL → auto-detect everything ---
  async function detectFromSample() {
    if (!sampleTileUrl) return;
    setProbing(true); setProbeImg(null); setProbeResults(null);
    setStitchStatus("Analyzing tile URL & finding bounds...");
    try {
      const r = await fetch("/api/probe?sampleTile=" + encodeURIComponent(sampleTileUrl));
      const d = await r.json();
      setProbeResults(d);
      if (d.success) {
        setTilePattern(d.pattern);
        setZoom(d.detectedZoom);
        setMinX(d.bounds.minX); setMinY(d.bounds.minY);
        setMaxX(d.bounds.maxX);
        setMaxY(d.bounds.maxY);
        const cols = d.bounds.maxX - d.bounds.minX + 1;
        const rows = d.bounds.maxY - d.bounds.minY + 1;
        setStitchStatus("Pattern: " + d.pattern + " | Zoom " + d.detectedZoom + " | " + cols + "x" + rows + " tiles (" + (cols * rows) + " total)");
        // Show probe image
        const testUrl = d.pattern.replace("{z}", d.detectedZoom).replace("{x}", d.detectedX).replace("{y}", d.detectedY);
        setProbeImg("/api/tile-proxy?url=" + encodeURIComponent(testUrl));
      } else {
        setStitchStatus("Could not detect pattern: " + (d.error || "unknown"));
      }
    } catch (e) {
      setStitchStatus("Error: " + e.message);
    }
    setProbing(false);
  }

  // --- STITCH ---
  function buildUrl(pattern, z, x, y) {
    if (swapXY) {
      return pattern.replace("{z}", z).replace("{x}", y).replace("{y}", x);
    }
    return pattern.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  }
  function loadImg(src) {
    return new Promise(res => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  }
  function proxied(u) {
    return useProxy ? "/api/tile-proxy?url=" + encodeURIComponent(u) : u;
  }

  // Show a 4x4 grid preview from the center of the map
  async function showGridPreview() {
    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);
    const grid = [];
    for (let dy = -1; dy <= 2; dy++) {
      const row = [];
      for (let dx = -1; dx <= 2; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        const rawUrl = buildUrl(tilePattern, zoom, x, y);
        row.push({
          x, y,
          url: proxied(rawUrl),
          label: "x=" + x + " y=" + y,
        });
      }
      grid.push(row);
    }
    setGridPreview(grid);
  }

  async function testOneTile() {
    setProbeImg(null);
    const u = proxied(buildUrl(tilePattern, zoom, minX, minY));
    setStitchStatus("Testing z=" + zoom + " x=" + minX + " y=" + minY + "...");
    const img = await loadImg(u);
    if (img) {
      setProbeImg(u);
      setStitchStatus("Tile OK! " + img.naturalWidth + "x" + img.naturalHeight + "px");
    } else {
      setStitchStatus("Failed. Check pattern/bounds.");
    }
  }

  async function stitch() {
    if (!tilePattern || stitching) return;
    setStitching(true); setPreviewUrl(null); setStitchProgress(0); setFailedTiles([]);
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const total = cols * rows, W = cols * tileSize, H = rows * tileSize;
    setStitchStatus("Stitching " + W + "x" + H + "px (" + total + " tiles)...");
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0a0a0f"; ctx.fillRect(0, 0, W, H);
    setCanvasCtx(ctx); setCanvasEl(c);

    const all = [];
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) all.push({ x, y });

    const { done, failed } = await downloadTiles(all, ctx, total);

    setFailedTiles(failed);
    setStitchStatus("Done! " + done + "/" + total + " tiles." + (failed.length > 0 ? " " + failed.length + " failed — tap Retry" : " ✅"));
    c.toBlob(blob => { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  async function retryFailed() {
    if (!canvasCtx || !canvasEl || failedTiles.length === 0 || stitching) return;
    setStitching(true); setStitchProgress(0);
    const total = failedTiles.length;
    setStitchStatus("Retrying " + total + " failed tiles (slower, 1 at a time)...");

    const { done, failed } = await downloadTiles(failedTiles, canvasCtx, total, true);

    setFailedTiles(failed);
    setStitchStatus("Retry done! " + done + " recovered." + (failed.length > 0 ? " " + failed.length + " still failing — tap Retry again" : " ✅ All tiles loaded!"));
    canvasEl.toBlob(blob => { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  async function downloadTiles(tiles, ctx, total, slow) {
    let done = 0;
    const failed = [];
    const batchSize = slow ? 1 : 2;
    const delayMs = slow ? 800 : 300;
    const maxRetries = slow ? 5 : 3;

    for (let i = 0; i < tiles.length; i += batchSize) {
      const b = tiles.slice(i, i + batchSize);
      await Promise.all(b.map(async ({ x, y }) => {
        const rawUrl = buildUrl(tilePattern, zoom, x, y);
        const u = proxied(rawUrl);

        let img = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          img = await loadImg(u);
          if (img) break;
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        }

        if (img) {
          const px = (flipX ? (maxX - x) : (x - minX)) * tileSize;
          const py = (flipY ? (maxY - y) : (y - minY)) * tileSize;
          ctx.drawImage(img, px, py, tileSize, tileSize);
          done++;
        } else {
          failed.push({ x, y });
        }
      }));

      await new Promise(r => setTimeout(r, delayMs));
      setStitchProgress(Math.round(((i + b.length) / tiles.length) * 100));
      setStitchStatus((slow ? "Retry: " : "") + (done + failed.length) + "/" + total + " (" + failed.length + " failed)");
    }

    return { done, failed };
  }
    setStitching(false);
  }

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Leaflet Tile Extractor</h1>
      <p style={S.sub}>Extract tile URLs → stitch full maps</p>

      <div style={S.tabs}>
        <button style={{...S.tab, ...(tab === "extract" ? S.tabOn : {})}} onClick={() => setTab("extract")}>Extract</button>
        <button style={{...S.tab, ...(tab === "stitch" ? S.tabOn : {})}} onClick={() => setTab("stitch")}>Stitch</button>
      </div>

      {tab === "extract" && <>
        <div style={S.card}>
          <div style={S.chips}>{PRESETS.map(p => (
            <button key={p.url} onClick={() => setUrl(p.url)} style={{...S.chip, ...(url === p.url ? S.chipOn : {})}}>{p.label}</button>
          ))}</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Map URL..." style={S.input} />
          <button onClick={extract} disabled={loading || !url} style={{...S.btn, ...(loading ? S.off : S.blue)}}>{loading ? "Scanning..." : "Extract"}</button>
          {status && <p style={S.st}>{status}</p>}
        </div>
        {results && (results.patterns.length > 0 || results.tiles.length > 0) && <div style={S.card}>
          {results.patterns.length > 0 && <>
            <p style={S.sec}>Patterns ({results.patterns.length}):</p>
            {results.patterns.map((p, i) => <div key={i} style={S.mono}>{p}</div>)}
          </>}
          {results.tiles.length > 0 && <>
            <p style={{...S.sec, marginTop: 12}}>Tiles ({results.tiles.length}):</p>
            <div style={{...S.mono, maxHeight: 160, overflowY: "auto"}}>{results.tiles.map((t, i) => <div key={i}>{t}</div>)}</div>
          </>}
          <div style={{display: "flex", gap: 8, marginTop: 10}}>
            <button onClick={() => {
              let t = (results.patterns || []).join("\n") + "\n" + (results.tiles || []).join("\n");
              navigator.clipboard.writeText(t).catch(() => {});
              setCopied(true); setTimeout(() => setCopied(false), 2000);
            }} style={{...S.btn, flex: 1, background: "#059669", color: "#fff"}}>{copied ? "Copied!" : "Copy"}</button>
            <button onClick={() => { if (results.patterns[0]) setTilePattern(results.patterns[0]); setTab("stitch"); }}
              style={{...S.btn, flex: 1, background: "#7c3aed", color: "#fff"}}>Stitch →</button>
          </div>
        </div>}
      </>}

      {tab === "stitch" && <>
        {/* PASTE ONE TILE URL - THE EASY WAY */}
        <div style={{...S.card, borderColor: "#7c3aed"}}>
          <p style={{...S.sec, color: "#a78bfa"}}>🎯 Paste One Tile URL</p>
          <p style={{fontSize: "0.72rem", color: "#888", marginBottom: 8}}>
            Use extract.pics on a map site → find any 256x256 tile → copy its URL → paste here.
            The app auto-detects the pattern and finds all tile bounds.
          </p>
          <input value={sampleTileUrl} onChange={e => setSampleTileUrl(e.target.value)}
            placeholder="https://cdn.example.com/tiles/3/4/5.png" style={S.input} />
          <button onClick={detectFromSample} disabled={probing || !sampleTileUrl}
            style={{...S.btn, ...(probing ? S.off : {background: "#7c3aed", color: "#fff"})}}>
            {probing ? "Detecting..." : "🎯 Auto-Detect Pattern & Bounds"}
          </button>

          {probeResults && probeResults.success && probeResults.bounds && probeResults.bounds.zoomInfo && <>
            <p style={{...S.sec, marginTop: 12}}>Available zoom levels:</p>
            <div style={S.mono}>
              {Object.entries(probeResults.bounds.zoomInfo).map(([z, info]) => (
                <div key={z} style={{cursor: "pointer"}} onClick={() => {
                  setZoom(parseInt(z));
                  setMinX(info.estimatedMinX || 0);
                  setMaxX(info.estimatedMaxX);
                  setMinY(info.estimatedMinY || 0);
                  setMaxY(info.estimatedMaxY);
                }}>
                  z={z}: [{info.estimatedMinX || 0}-{info.estimatedMaxX}] x [{info.estimatedMinY || 0}-{info.estimatedMaxY}] ~{info.estimatedTiles || "?"} tiles
                  {parseInt(z) === zoom ? " ← selected" : " (tap)"}
                </div>
              ))}
            </div>
          </>}
        </div>

        {/* MANUAL TILE PATTERN */}
        <div style={S.card}>
          <p style={S.sec}>Tile Settings</p>
          <input value={tilePattern} onChange={e => setTilePattern(e.target.value)}
            placeholder="https://.../{z}/{x}/{y}.png" style={S.input} />
          <div style={S.g3}>
            <div><p style={S.ml}>Zoom</p><input type="number" value={zoom} onChange={e => setZoom(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Tile px</p><input type="number" value={tileSize} onChange={e => setTileSize(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Proxy</p><button onClick={() => setUseProxy(!useProxy)} style={{...S.si, background: useProxy ? "#059669" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"}}>{useProxy ? "ON" : "OFF"}</button></div>
          </div>
          <div style={S.g3}>
            <div><p style={S.ml}>Flip Y (TMS)</p><button onClick={() => setFlipY(!flipY)} style={{...S.si, background: flipY ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"}}>{flipY ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Flip X</p><button onClick={() => setFlipX(!flipX)} style={{...S.si, background: flipX ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"}}>{flipX ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Swap X↔Y</p><button onClick={() => setSwapXY(!swapXY)} style={{...S.si, background: swapXY ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"}}>{swapXY ? "ON" : "OFF"}</button></div>
          </div>
          <div style={S.g4}>
            <div><p style={S.ml}>Min X</p><input type="number" value={minX} onChange={e => setMinX(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Max X</p><input type="number" value={maxX} onChange={e => setMaxX(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Min Y</p><input type="number" value={minY} onChange={e => setMinY(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Max Y</p><input type="number" value={maxY} onChange={e => setMaxY(+e.target.value)} style={S.si} /></div>
          </div>
          <p style={{fontSize: "0.72rem", color: "#666", marginTop: 6}}>
            Output: {(maxX - minX + 1) * tileSize}x{(maxY - minY + 1) * tileSize}px ({(maxX - minX + 1) * (maxY - minY + 1)} tiles)
          </p>
          <div style={{display: "flex", gap: 8, marginTop: 10}}>
            <button onClick={testOneTile} disabled={!tilePattern} style={{...S.btn, flex: 1, background: "#d97706", color: "#fff"}}>Test 1</button>
            <button onClick={showGridPreview} disabled={!tilePattern} style={{...S.btn, flex: 1, background: "#6d28d9", color: "#fff"}}>4x4 Grid</button>
            <button onClick={stitch} disabled={stitching || !tilePattern} style={{...S.btn, flex: 1, ...(stitching ? S.off : S.blue)}}>{stitching ? "..." : "Stitch All"}</button>
          </div>
          {stitchStatus && <p style={S.st}>{stitchStatus}</p>}
          {stitching && stitchProgress > 0 && <div style={S.bar}><div style={{...S.fill, width: stitchProgress + "%"}} /></div>}
        </div>

        {probeImg && <div style={S.card}>
          <p style={S.sec}>Tile Preview:</p>
          <img src={probeImg} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="probe" />
        </div>}

        {gridPreview && <div style={S.card}>
          <p style={S.sec}>4x4 Grid Preview (center of map):</p>
          <p style={{fontSize: "0.7rem", color: "#888", marginBottom: 8}}>
            If tiles don{"'"}t form a smooth image, try toggling Swap X↔Y or Flip options above, then tap "4x4 Grid" again.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "#000", borderRadius: 6, overflow: "hidden"}}>
            {gridPreview.flat().map((tile, i) => (
              <div key={i} style={{position: "relative", background: "#0a0a0f"}}>
                <img src={tile.url} style={{width: "100%", display: "block"}}
                  alt={tile.label} onError={(e) => {e.target.style.opacity = 0.1;}} />
                <div style={{position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#6ee7b7", fontSize: "0.5rem", padding: "2px 4px", textAlign: "center"}}>
                  {tile.label}
                </div>
              </div>
            ))}
          </div>
        </div>}

        {previewUrl && <div style={S.card}>
          <p style={S.sec}>Stitched Map:</p>
          <img src={previewUrl} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="map" />
          <div style={{display: "flex", gap: 8, marginTop: 10}}>
            {failedTiles.length > 0 && (
              <button onClick={retryFailed} disabled={stitching}
                style={{...S.btn, flex: 1, ...(stitching ? S.off : {background: "#d97706", color: "#fff"})}}>
                {stitching ? "Retrying..." : "🔄 Retry " + failedTiles.length + " Failed"}
              </button>
            )}
            <button onClick={() => { const a = document.createElement("a"); a.href = previewUrl; a.download = "wuwa_map_z" + zoom + ".png"; a.click(); }}
              style={{...S.btn, flex: 1, background: "#059669", color: "#fff"}}>Download PNG</button>
          </div>
        </div>}

        {/* INSTRUCTIONS */}
        <div style={{...S.card, borderColor: "#333"}}>
          <p style={S.sec}>How to get a tile URL</p>
          <p style={{fontSize: "0.75rem", color: "#999", lineHeight: 1.7}}>
            1. Open <b>extract.pics</b> in your browser<br/>
            2. Paste a map URL (e.g. wuthering-waves-map.appsample.com)<br/>
            3. Hit Extract<br/>
            4. Find a 256x256 map tile in the results<br/>
            5. Tap the link icon to copy its URL<br/>
            6. Paste it above → tap Auto-Detect<br/>
            7. Adjust zoom level → Stitch All → Download
          </p>
        </div>
      </>}
    </div>
  );
}

const S = {
  wrap: { maxWidth: 600, margin: "0 auto", padding: 16, fontFamily: "-apple-system,sans-serif", background: "#0a0a0f", color: "#e0e0e8", minHeight: "100vh" },
  h1: { fontSize: "1.3rem", fontWeight: 700, color: "#6ee7b7", marginBottom: 2 },
  sub: { fontSize: "0.75rem", color: "#777", marginBottom: 14 },
  tabs: { display: "flex", gap: 4, marginBottom: 12 },
  tab: { flex: 1, padding: 11, border: "1px solid #333", borderRadius: 8, background: "#15151f", color: "#888", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", textAlign: "center" },
  tabOn: { background: "#1e3a5f", color: "#93c5fd", borderColor: "#3b82f6" },
  card: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 },
  chips: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 },
  chip: { fontSize: "0.7rem", background: "#1e1e2e", color: "#93c5fd", border: "1px solid #333", borderRadius: 6, padding: "5px 8px", cursor: "pointer" },
  chipOn: { background: "#1e3a5f", borderColor: "#3b82f6" },
  input: { width: "100%", padding: 11, background: "#0d0d14", border: "1px solid #333", borderRadius: 8, color: "#eee", fontSize: "0.8rem", marginBottom: 8, boxSizing: "border-box" },
  si: { width: "100%", padding: 9, background: "#0d0d14", border: "1px solid #333", borderRadius: 8, color: "#eee", fontSize: "0.8rem", boxSizing: "border-box" },
  btn: { display: "block", width: "100%", padding: 12, border: "none", borderRadius: 8, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", color: "#fff", textAlign: "center" },
  blue: { background: "#3b82f6" },
  off: { background: "#555", cursor: "not-allowed" },
  st: { fontSize: "0.75rem", color: "#fbbf24", marginTop: 8 },
  sec: { fontSize: "0.85rem", fontWeight: 600, color: "#fbbf24", marginBottom: 6 },
  mono: { background: "#0d0d14", border: "1px solid #2a2a3a", borderRadius: 6, padding: 8, fontFamily: "monospace", fontSize: "0.65rem", color: "#6ee7b7", wordBreak: "break-all", marginBottom: 5 },
  ml: { fontSize: "0.68rem", color: "#888", marginBottom: 3 },
  g3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 },
  g4: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 8 },
  bar: { width: "100%", height: 6, background: "#1e1e2e", borderRadius: 4, marginTop: 8, overflow: "hidden" },
  fill: { height: "100%", background: "#3b82f6", borderRadius: 4, transition: "width 0.3s" },
};
