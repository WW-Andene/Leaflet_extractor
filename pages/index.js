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

const KNOWN_MAPS = [
  { id: "AkiWorld_WP", label: "Overworld (Huanglong+)" },
  { id: "WP_Xueyuan", label: "Xueyuan" },
  { id: "WP_2_8_Cafe", label: "Cafe (2.8)" },
  { id: "WP_2_8_Suibo", label: "Suibo (2.8)" },
  { id: "WP_HDSYC", label: "HDSYC" },
  { id: "WP_DianDaoTa2", label: "DianDaoTa2" },
  { id: "WP_HHA_Underground", label: "HHA Underground" },
  { id: "WP_JK_Underground", label: "JK Underground" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("extract");

  // Stitch state
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
  const [probeImg, setProbeImg] = useState(null);
  const [probing, setProbing] = useState(false);
  const [selectedMap, setSelectedMap] = useState("AkiWorld_WP");

  // --- EXTRACT ---
  async function extract() {
    if (!url) return;
    setLoading(true); setResults(null);
    setStatus("Fetching & scanning...");
    try {
      const r = await fetch("/api/extract?url=" + encodeURIComponent(url));
      const d = await r.json();
      if (d.error) setStatus("Error: " + d.error);
      else {
        setStatus(d.patterns.length + d.tiles.length > 0
          ? "Found " + d.patterns.length + " pattern(s), " + d.tiles.length + " tile(s)"
          : "No tiles found.");
        setResults(d);
        if (d.patterns.length > 0) setTilePattern(d.patterns[0]);
      }
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  }

  function copyAll() {
    if (!results) return;
    let t = results.patterns.join("\n") + "\n" + results.tiles.join("\n");
    navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  // --- AUTO PROBE CDN ---
  async function autoProbe() {
    setProbing(true); setProbeImg(null);
    setStitchStatus("Probing CDN patterns for " + selectedMap + "...");
    try {
      const r = await fetch("/api/probe?mapId=" + encodeURIComponent(selectedMap));
      const d = await r.json();
      if (d.working && d.working.length > 0) {
        const w = d.working[0];
        setTilePattern(w.pattern);
        setStitchStatus("Found working pattern! " + w.pattern + " (tested z=" + w.z + " x=" + w.x + " y=" + w.y + ")");
        // Load probe image for preview
        const testUrl = w.testedUrl;
        setProbeImg("/api/tile-proxy?url=" + encodeURIComponent(testUrl));
      } else {
        setStitchStatus("No working tile pattern found for " + selectedMap + ". Tested " + d.candidatesTested + " patterns.");
      }
    } catch (e) {
      setStitchStatus("Probe error: " + e.message);
    }
    setProbing(false);
  }

  // --- STITCH ---
  function tileUrl(pattern, z, x, y) {
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

  async function testOneTile() {
    setProbeImg(null);
    const u = proxied(tileUrl(tilePattern, zoom, minX, minY));
    setStitchStatus("Testing z=" + zoom + " x=" + minX + " y=" + minY + "...");
    const img = await loadImg(u);
    if (img) {
      setProbeImg(u);
      setStitchStatus("Tile OK! " + img.naturalWidth + "x" + img.naturalHeight + "px");
    } else {
      setStitchStatus("Failed. Try Auto Probe or check pattern.");
    }
  }

  async function stitch() {
    if (!tilePattern || stitching) return;
    setStitching(true); setPreviewUrl(null); setStitchProgress(0);
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const total = cols * rows, W = cols * tileSize, H = rows * tileSize;
    setStitchStatus("Stitching " + W + "x" + H + "px (" + total + " tiles)...");
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0a0a0f"; ctx.fillRect(0, 0, W, H);
    let done = 0, fail = 0;
    const all = [];
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) all.push({ x, y });
    const batch = 6;
    for (let i = 0; i < all.length; i += batch) {
      const b = all.slice(i, i + batch);
      await Promise.all(b.map(async ({ x, y }) => {
        const u = proxied(tileUrl(tilePattern, zoom, x, y));
        const img = await loadImg(u);
        if (img) { ctx.drawImage(img, (x - minX) * tileSize, (y - minY) * tileSize, tileSize, tileSize); done++; }
        else fail++;
      }));
      setStitchProgress(Math.round(((i + b.length) / all.length) * 100));
      setStitchStatus((done + fail) + "/" + total + " (" + fail + " failed)");
    }
    setStitchStatus("Done! " + done + " loaded, " + fail + " failed. " + W + "x" + H + "px");
    c.toBlob(blob => { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Leaflet Tile Extractor</h1>
      <p style={S.sub}>Extract tile URLs + stitch full maps</p>

      <div style={S.tabs}>
        <button style={{...S.tab, ...(tab === "extract" ? S.tabOn : {})}} onClick={() => setTab("extract")}>Extract</button>
        <button style={{...S.tab, ...(tab === "stitch" ? S.tabOn : {})}} onClick={() => setTab("stitch")}>Stitch</button>
      </div>

      {tab === "extract" && <>
        <div style={S.card}>
          <div style={S.presets}>{PRESETS.map(p => (
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
            <button onClick={copyAll} style={{...S.btn, flex: 1, background: "#059669", color: "#fff"}}>{copied ? "Copied!" : "Copy"}</button>
            <button onClick={() => { if (results.patterns[0]) setTilePattern(results.patterns[0]); setTab("stitch"); }} style={{...S.btn, flex: 1, background: "#7c3aed", color: "#fff"}}>Stitch →</button>
          </div>
        </div>}
      </>}

      {tab === "stitch" && <>
        {/* AUTO PROBE SECTION */}
        <div style={S.card}>
          <p style={S.sec}>Auto Probe (TH.GL CDN)</p>
          <p style={{fontSize: "0.72rem", color: "#888", marginBottom: 8}}>
            Select a map ID and probe the CDN for the correct tile pattern
          </p>
          <div style={S.presets}>
            {KNOWN_MAPS.map(m => (
              <button key={m.id} onClick={() => setSelectedMap(m.id)}
                style={{...S.chip, ...(selectedMap === m.id ? S.chipOn : {})}}>
                {m.label}
              </button>
            ))}
          </div>
          <div style={{display: "flex", gap: 8, marginTop: 10}}>
            <input value={selectedMap} onChange={e => setSelectedMap(e.target.value)}
              placeholder="Custom map ID..." style={{...S.input, flex: 1, marginBottom: 0}} />
            <button onClick={autoProbe} disabled={probing}
              style={{...S.btn, width: "auto", padding: "0 20px", ...(probing ? S.off : {background: "#d97706", color: "#fff"})}}>
              {probing ? "..." : "Probe"}
            </button>
          </div>
        </div>

        {/* MANUAL TILE PATTERN */}
        <div style={S.card}>
          <p style={S.sec}>Tile Pattern</p>
          <input value={tilePattern} onChange={e => setTilePattern(e.target.value)}
            placeholder="https://cdn.th.gl/.../AkiWorld_WP/{z}/{x}/{y}.webp" style={S.input} />
          <div style={S.g3}>
            <div><p style={S.ml}>Zoom</p><input type="number" value={zoom} onChange={e => setZoom(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Tile px</p><input type="number" value={tileSize} onChange={e => setTileSize(+e.target.value)} style={S.si} /></div>
            <div><p style={S.ml}>Proxy</p><button onClick={() => setUseProxy(!useProxy)} style={{...S.si, background: useProxy ? "#059669" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"}}>{useProxy ? "ON" : "OFF"}</button></div>
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
            <button onClick={testOneTile} disabled={!tilePattern} style={{...S.btn, flex: 1, background: "#d97706", color: "#fff"}}>Test 1 Tile</button>
            <button onClick={stitch} disabled={stitching || !tilePattern} style={{...S.btn, flex: 1, ...(stitching ? S.off : S.blue)}}>{stitching ? "Stitching..." : "Stitch All"}</button>
          </div>
          {stitchStatus && <p style={S.st}>{stitchStatus}</p>}
          {stitching && stitchProgress > 0 && <div style={S.bar}><div style={{...S.fill, width: stitchProgress + "%"}} /></div>}
        </div>

        {/* PROBE PREVIEW */}
        {probeImg && <div style={S.card}>
          <p style={S.sec}>Probe Preview:</p>
          <img src={probeImg} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="probe" />
        </div>}

        {/* STITCHED MAP */}
        {previewUrl && <div style={S.card}>
          <p style={S.sec}>Stitched Map:</p>
          <img src={previewUrl} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="map" />
          <button onClick={() => { const a = document.createElement("a"); a.href = previewUrl; a.download = "wuwa_map_z" + zoom + ".png"; a.click(); }}
            style={{...S.btn, background: "#059669", color: "#fff", marginTop: 10}}>
            Download PNG
          </button>
        </div>}
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
  presets: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 },
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
