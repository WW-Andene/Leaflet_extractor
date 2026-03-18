import { useState, useRef, useCallback } from "react";

var MAX_TILES = 8192;

var COORD_ORDERS = ["zxy", "zyx", "xzy", "xyz", "yzx", "yxz"];

function buildUrl(pat, z, x, y, order) {
  var o = order || "zxy";
  var vals = { z: z, x: x, y: y };
  return pat.replace("{z}", vals[o[0]]).replace("{x}", vals[o[1]]).replace("{y}", vals[o[2]]);
}
function tileKey(src, x, y) { return src + ":" + x + "," + y; }
function loadImgAsDataUrl(src) {
  return new Promise(function(res) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
      var c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      try { res(c.toDataURL("image/png")); } catch(e) { res(null); }
    };
    img.onerror = function() { res(null); };
    img.src = src;
  });
}
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function emptySource() {
  return { name: "", pattern: "", zoom: 3, minX: 0, maxX: 7, minY: 0, maxY: 7,
    tileSize: 256, color: COLORS[0], coordOrder: "zxy", transpose: false, flipX: false, flipY: false };
}
var COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b"];
var TOOLS = ["place", "pick", "swap", "erase"];
var TOOL_LABELS = { place: "Place", pick: "Pick", swap: "Swap", erase: "Erase" };
var TOOL_COLORS = { place: "#3b82f6", pick: "#8b5cf6", swap: "#f59e0b", erase: "#ef4444" };

export default function EditorTab() {
  var s = useState, a;
  a = s([Object.assign(emptySource(), { name: "Source 1", color: COLORS[0] })]);
  var sources = a[0], setSources = a[1];
  a = s(0); var activeSrc = a[0], setActiveSrc = a[1];
  var bankRef = useRef({});
  var abortRef = useRef(false);
  a = s(false); var loadingSrc = a[0], setLoadingSrc = a[1];
  a = s(""); var loadStatus = a[0], setLoadStatus = a[1];
  a = s(0); var loadProgress = a[0], setLoadProgress = a[1];
  a = s(16); var gridW = a[0], setGridW = a[1];
  a = s(16); var gridH = a[0], setGridH = a[1];
  a = s(function() { return new Array(16 * 16).fill(null); });
  var grid = a[0], setGrid = a[1];
  a = s("place"); var tool = a[0], setTool = a[1];
  a = s(null); var selected = a[0], setSelected = a[1];
  a = s(null); var swapFirst = a[0], setSwapFirst = a[1];
  a = s(-1); var paletteFilter = a[0], setPaletteFilter = a[1];
  a = s([]); var paletteTiles = a[0], setPaletteTiles = a[1];
  a = s(1); var gridZoom = a[0], setGridZoom = a[1];
  a = s(""); var dlStatus = a[0], setDlStatus = a[1];
  a = s(""); var sampleUrl = a[0], setSampleUrl = a[1];
  a = s(false); var detecting = a[0], setDetecting = a[1];
  a = s(null); var srcPreview = a[0], setSrcPreview = a[1];

  var rebuildPalette = useCallback(function() {
    var bank = bankRef.current;
    var items = [];
    var keys = Object.keys(bank);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var parts = k.split(":");
      var srcIdx = parseInt(parts[0]);
      var coords = parts[1].split(",");
      if (bank[k]) items.push({ key: k, dataUrl: bank[k], srcIdx: srcIdx, ox: parseInt(coords[0]), oy: parseInt(coords[1]) });
    }
    items.sort(function(a2, b) {
      if (a2.srcIdx !== b.srcIdx) return a2.srcIdx - b.srcIdx;
      if (a2.oy !== b.oy) return a2.oy - b.oy;
      return a2.ox - b.ox;
    });
    setPaletteTiles(items);
  }, []);

  function resizeGrid(newW, newH) {
    var w = Math.max(newW, 1); var h = Math.max(newH, 1);
    if (w * h > MAX_TILES) return;
    setGrid(function(old) {
      var oldW = gridW;
      var ng = new Array(w * h).fill(null);
      for (var gy = 0; gy < h; gy++)
        for (var gx = 0; gx < w; gx++)
          if (gx < oldW && gy < Math.floor(old.length / oldW)) ng[gy * w + gx] = old[gy * oldW + gx];
      return ng;
    });
    setGridW(w); setGridH(h);
  }

  function updateSource(idx, field, val) {
    setSources(function(prev) { var n = prev.slice(); n[idx] = Object.assign({}, n[idx]); n[idx][field] = val; return n; });
  }
  function addSource() {
    if (sources.length >= 4) return;
    setSources(function(prev) { return prev.concat([Object.assign(emptySource(), { name: "Source " + (prev.length + 1), color: COLORS[prev.length % 4] })]); });
  }
  function removeSource(idx) {
    var bank = bankRef.current;
    Object.keys(bank).forEach(function(k) { if (k.startsWith(idx + ":")) delete bank[k]; });
    setGrid(function(old) { return old.map(function(cell) { return cell && cell.srcIdx === idx ? null : cell; }); });
    setSources(function(prev) { var n = prev.slice(); n.splice(idx, 1); return n; });
    if (activeSrc >= sources.length - 1) setActiveSrc(Math.max(0, sources.length - 2));
    rebuildPalette();
  }

  async function detectSource() {
    if (!sampleUrl || detecting) return;
    setDetecting(true); setLoadStatus("Detecting...");
    try {
      var r = await fetch("/api/probe?sampleTile=" + encodeURIComponent(sampleUrl));
      var d = await r.json();
      if (d.success) {
        updateSource(activeSrc, "pattern", d.pattern);
        updateSource(activeSrc, "zoom", d.detectedZoom);
        if (d.bounds) { updateSource(activeSrc, "minX", d.bounds.minX); updateSource(activeSrc, "maxX", d.bounds.maxX); updateSource(activeSrc, "minY", d.bounds.minY); updateSource(activeSrc, "maxY", d.bounds.maxY); }
        var cols = d.bounds ? (d.bounds.maxX - d.bounds.minX + 1) : 0;
        var rows = d.bounds ? (d.bounds.maxY - d.bounds.minY + 1) : 0;
        setLoadStatus("Detected: " + d.format + " | " + cols + "x" + rows + " tiles z" + d.detectedZoom);
      } else setLoadStatus("Failed: " + (d.error || "unknown"));
    } catch (e) { setLoadStatus("Error: " + e.message); }
    setDetecting(false);
  }

  function showSrcPreview(idx) {
    var src = sources[idx]; if (!src.pattern) return;
    var cx = Math.round((src.minX + src.maxX) / 2), cy = Math.round((src.minY + src.maxY) / 2);
    var rows = [];
    for (var dy = -1; dy <= 2; dy++) {
      var row = [];
      for (var dx = -1; dx <= 2; dx++) {
        var x = cx + dx, y = cy + dy;
        row.push({ x: x, y: y, url: "/api/tile-proxy?url=" + encodeURIComponent(buildUrl(src.pattern, src.zoom, x, y, src.coordOrder)), label: "x=" + x + " y=" + y });
      }
      rows.push(row);
    }
    setSrcPreview({ rows: rows, srcIdx: idx });
  }

  // --- LOAD WITH ABORT ---
  async function loadSource(idx) {
    var src = sources[idx];
    if (!src.pattern || loadingSrc) return;
    abortRef.current = false;
    setLoadingSrc(true); setLoadProgress(0);
    var bank = bankRef.current;
    var cols = src.maxX - src.minX + 1, rows = src.maxY - src.minY + 1, total = cols * rows;
    setLoadStatus("Loading " + total + " tiles...");
    var done = 0, failed = 0;
    for (var y = src.minY; y <= src.maxY; y++) {
      for (var x = src.minX; x <= src.maxX; x++) {
        if (abortRef.current) {
          setLoadStatus("Stopped! " + done + " loaded, " + failed + " failed, " + (total - done - failed) + " skipped");
          setLoadingSrc(false); rebuildPalette(); return;
        }
        var key = tileKey(idx, x, y);
        if (bank[key]) { done++; setLoadProgress(Math.round(((done + failed) / total) * 100)); continue; }
        var rawUrl = buildUrl(src.pattern, src.zoom, x, y, src.coordOrder);
        var dataUrl = await loadImgAsDataUrl("/api/tile-proxy?url=" + encodeURIComponent(rawUrl));
        if (dataUrl) { bank[key] = dataUrl; done++; } else failed++;
        setLoadProgress(Math.round(((done + failed) / total) * 100));
        setLoadStatus("Loading: " + (done + failed) + "/" + total + " (" + failed + " failed)");
        await wait(150);
      }
    }
    rebuildPalette();
    setLoadStatus("Loaded " + done + "/" + total + (failed > 0 ? " (" + failed + " failed)" : " - all OK!"));
    setLoadingSrc(false);
  }

  function stopLoading() { abortRef.current = true; }

  function autoPlace(idx) {
    var src = sources[idx]; var bank = bankRef.current;
    var srcCols = src.maxX - src.minX + 1, srcRows = src.maxY - src.minY + 1;
    // transpose swaps grid layout (cols/rows)
    var placeCols = src.transpose ? srcRows : srcCols;
    var placeRows = src.transpose ? srcCols : srcRows;
    var oldW = gridW, oldH = gridH, oldGrid = grid;
    var hasContent = false, exMinX = oldW, exMaxX = 0, exMinY = oldH, exMaxY = 0;
    for (var i = 0; i < oldGrid.length; i++) {
      if (oldGrid[i]) { var cx = i % oldW, cy = Math.floor(i / oldW); hasContent = true;
        if (cx < exMinX) exMinX = cx; if (cx > exMaxX) exMaxX = cx;
        if (cy < exMinY) exMinY = cy; if (cy > exMaxY) exMaxY = cy; }
    }
    var offX, offY, newW, newH;
    if (!hasContent) {
      newW = placeCols; newH = placeRows;
      offX = 0; offY = 0;
    } else {
      offX = exMaxX + 1; offY = exMinY;
      if (offX + placeCols > oldW + placeCols + 2) { offX = exMinX; offY = exMaxY + 1; }
      newW = Math.max(oldW, offX + placeCols); newH = Math.max(oldH, offY + placeRows);
    }
    if (newW * newH > MAX_TILES) { offX = 0; offY = 0; newW = Math.max(oldW, placeCols); newH = Math.max(oldH, placeRows); }
    var ng = new Array(newW * newH).fill(null);
    for (var gy = 0; gy < newH; gy++) for (var gx = 0; gx < newW; gx++)
      if (gx < oldW && gy < oldH) { var oi = gy * oldW + gx; if (oi < oldGrid.length && oldGrid[oi]) ng[gy * newW + gx] = oldGrid[oi]; }
    for (var dy = 0; dy < srcRows; dy++) for (var dx = 0; dx < srcCols; dx++) {
      var tileX = src.minX + dx, tileY = src.minY + dy;
      var key = tileKey(idx, tileX, tileY); if (!bank[key]) continue;
      // transpose: swap dx/dy on grid. Flip applied after.
      var rawGx = src.transpose ? dy : dx;
      var rawGy = src.transpose ? dx : dy;
      var maxGx = src.transpose ? (srcRows - 1) : (srcCols - 1);
      var maxGy = src.transpose ? (srcCols - 1) : (srcRows - 1);
      var gx2 = src.flipX ? (maxGx - rawGx) : rawGx;
      var gy2 = src.flipY ? (maxGy - rawGy) : rawGy;
      var gi = (offY + gy2) * newW + (offX + gx2);
      if (gi >= 0 && gi < ng.length) ng[gi] = { key: key, dataUrl: bank[key], srcIdx: idx, ox: tileX, oy: tileY };
    }
    setGrid(ng); setGridW(newW); setGridH(newH);
  }

  function onCellClick(idx) {
    if (tool === "place") { if (!selected) return; setGrid(function(old) { var ng = old.slice(); ng[idx] = Object.assign({}, selected); return ng; }); }
    else if (tool === "pick") { var cell = grid[idx]; if (cell) { setSelected(Object.assign({}, cell)); setTool("place"); } }
    else if (tool === "swap") { if (swapFirst === null) setSwapFirst(idx); else { setGrid(function(old) { var ng = old.slice(); var tmp = ng[swapFirst]; ng[swapFirst] = ng[idx]; ng[idx] = tmp; return ng; }); setSwapFirst(null); } }
    else if (tool === "erase") { setGrid(function(old) { var ng = old.slice(); ng[idx] = null; return ng; }); }
  }

  function downloadGrid() {
    var tSize = sources[activeSrc] ? sources[activeSrc].tileSize : 256;
    var W = gridW * tSize, H = gridH * tSize;
    if (gridW * gridH > MAX_TILES) { setDlStatus("Exceeds " + MAX_TILES + " tiles!"); return; }
    setDlStatus("Rendering " + W + "x" + H + "px...");
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var ctx = c.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    var total = grid.filter(function(cell) { return cell !== null; }).length;
    if (total === 0) { setDlStatus("Grid is empty!"); return; }
    var promises = [];
    for (var i = 0; i < grid.length; i++) { if (!grid[i]) continue;
      (function(idx2, cell) { var gx = idx2 % gridW, gy = Math.floor(idx2 / gridW);
        promises.push(new Promise(function(res) { var img = new Image();
          img.onload = function() { ctx.drawImage(img, gx * tSize, gy * tSize, tSize, tSize); res(); };
          img.onerror = function() { res(); }; img.src = cell.dataUrl; }));
      })(i, grid[i]); }
    Promise.all(promises).then(function() {
      c.toBlob(function(blob) { if (!blob) { setDlStatus("Render failed"); return; }
        var dl = document.createElement("a"); dl.href = URL.createObjectURL(blob);
        dl.download = "tilemap_" + W + "x" + H + ".png"; dl.click();
        setDlStatus("Downloaded " + W + "x" + H + "px!"); }, "image/png"); });
  }

  function clearGrid() { setGrid(new Array(gridW * gridH).fill(null)); setSwapFirst(null); }
  function toggleSrc(field) { return function() { setSources(function(prev) { var n = prev.slice(); n[activeSrc] = Object.assign({}, n[activeSrc]); n[activeSrc][field] = !n[activeSrc][field]; return n; }); }; }
  var visiblePalette = paletteFilter === -1 ? paletteTiles : paletteTiles.filter(function(t) { return t.srcIdx === paletteFilter; });
  var filledCount = grid.filter(function(c2) { return c2 !== null; }).length;

  return <>
    {/* SOURCES */}
    <div style={S.card}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8}}>
        <p style={S.sec}>{"Sources (" + sources.length + "/4)"}</p>
        {sources.length < 4 && <button onClick={addSource} style={Object.assign({}, S.sm, {background: "#059669"})}>+ Add</button>}
      </div>
      <div style={{display: "flex", gap: 3, marginBottom: 10}}>
        {sources.map(function(src, i) {
          return <button key={i} onClick={function(){setActiveSrc(i)}}
            style={Object.assign({}, S.stab, i === activeSrc ? {background: src.color + "33", borderColor: src.color, color: "#fff"} : {})}>
            <span style={{display: "inline-block", width: 8, height: 8, borderRadius: 4, background: src.color, marginRight: 4}} />
            {src.name || "S" + (i + 1)}
          </button>;
        })}
      </div>
      {sources[activeSrc] && (function() {
        var src = sources[activeSrc]; var idx = activeSrc;
        var cols = src.maxX - src.minX + 1, rows = src.maxY - src.minY + 1;
        return <>
          <input value={src.name} onChange={function(e){updateSource(idx, "name", e.target.value)}} placeholder="Source name" style={Object.assign({}, S.input, {marginBottom: 4})} />
          <div style={{display: "flex", gap: 4, marginBottom: 6}}>
            <input value={sampleUrl} onChange={function(e){setSampleUrl(e.target.value)}} placeholder="Paste tile URL to auto-detect..." style={Object.assign({}, S.input, {flex: 1, marginBottom: 0})} />
            <button onClick={detectSource} disabled={detecting || !sampleUrl} style={Object.assign({}, S.sm, {background: "#7c3aed", whiteSpace: "nowrap"})}>{detecting ? "..." : "Detect"}</button>
          </div>
          <input value={src.pattern} onChange={function(e){updateSource(idx, "pattern", e.target.value)}} placeholder=".../{z}/{x}/{y}.webp or {z}/tile-{x}_{y}.jpg" style={S.input} />
          <div style={S.g5}>
            <div><p style={S.ml}>Zoom</p><input type="number" value={src.zoom} onChange={function(e){updateSource(idx, "zoom", +e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>MinX</p><input type="number" value={src.minX} onChange={function(e){updateSource(idx, "minX", +e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>MaxX</p><input type="number" value={src.maxX} onChange={function(e){updateSource(idx, "maxX", +e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>MinY</p><input type="number" value={src.minY} onChange={function(e){updateSource(idx, "minY", +e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>MaxY</p><input type="number" value={src.maxY} onChange={function(e){updateSource(idx, "maxY", +e.target.value)}} style={S.si} /></div>
          </div>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8}}>
            <div><p style={S.ml}>Order</p><button onClick={function(){
              var i = COORD_ORDERS.indexOf(src.coordOrder);
              updateSource(idx, "coordOrder", COORD_ORDERS[(i + 1) % COORD_ORDERS.length]);
            }} style={Object.assign({}, S.toggle, {background: src.coordOrder !== "zxy" ? "#d97706" : "#333"})}>{src.coordOrder.toUpperCase()}</button></div>
            <div><p style={S.ml}>Transpose</p><button onClick={toggleSrc("transpose")} style={Object.assign({}, S.toggle, {background: src.transpose ? "#d97706" : "#333"})}>{src.transpose ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Flip X</p><button onClick={toggleSrc("flipX")} style={Object.assign({}, S.toggle, {background: src.flipX ? "#d97706" : "#333"})}>{src.flipX ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Flip Y</p><button onClick={toggleSrc("flipY")} style={Object.assign({}, S.toggle, {background: src.flipY ? "#d97706" : "#333"})}>{src.flipY ? "ON" : "OFF"}</button></div>
          </div>
          <p style={{fontSize: "0.65rem", color: "#666", marginTop: 4}}>{cols + "x" + rows + " = " + (cols * rows) + " tiles"}</p>
          <div style={{display: "flex", gap: 4, marginTop: 8}}>
            <button onClick={function(){showSrcPreview(idx)}} disabled={!src.pattern} style={Object.assign({}, S.btn, {flex: 1, background: "#d97706"})}>4x4</button>
            {!loadingSrc && <button onClick={function(){loadSource(idx)}} disabled={!src.pattern} style={Object.assign({}, S.btn, {flex: 2, background: src.color})}>Load</button>}
            {loadingSrc && <button onClick={stopLoading} style={Object.assign({}, S.btn, {flex: 2, background: "#dc2626"})}>Stop</button>}
            <button onClick={function(){autoPlace(idx)}} style={Object.assign({}, S.btn, {flex: 1, background: "#6d28d9"})}>Place</button>
            {sources.length > 1 && <button onClick={function(){removeSource(idx)}} style={Object.assign({}, S.btn, {flex: 0, padding: "8px 12px", background: "#7f1d1d"})}>X</button>}
          </div>
        </>;
      })()}
      {loadStatus && <p style={S.st}>{loadStatus}</p>}
      {loadingSrc && loadProgress > 0 && <div style={S.bar}><div style={Object.assign({}, S.fill, {width: loadProgress + "%"})} /></div>}
    </div>

    {/* 4x4 PREVIEW */}
    {srcPreview && <div style={S.card}>
      <p style={S.sec}>{"4x4 Preview (Source " + (srcPreview.srcIdx + 1) + ")"}</p>
      <p style={{fontSize: "0.68rem", color: "#888", marginBottom: 6}}>If wrong, cycle Order or toggle Transpose/Flip, tap 4x4 again.</p>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "#000", borderRadius: 6, overflow: "hidden"}}>
        {srcPreview.rows.flat().map(function(tile, i) {
          return <div key={i} style={{position: "relative", background: "#0a0a0f"}}>
            <img src={tile.url} style={{width: "100%", display: "block"}} alt={tile.label} onError={function(e){e.target.style.opacity = 0.1}} />
            <div style={{position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#6ee7b7", fontSize: "0.42rem", padding: "1px 2px", textAlign: "center"}}>{tile.label}</div>
          </div>;
        })}
      </div>
    </div>}

    {/* PALETTE */}
    {paletteTiles.length > 0 && <div style={S.card}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
        <p style={S.sec}>{"Palette (" + paletteTiles.length + ")"}</p>
        <div style={{display: "flex", gap: 3}}>
          <button onClick={function(){setPaletteFilter(-1)}} style={Object.assign({}, S.sm, paletteFilter === -1 ? {background: "#555"} : {})}>All</button>
          {sources.map(function(src, i) { return <button key={i} onClick={function(){setPaletteFilter(i)}} style={Object.assign({}, S.sm, paletteFilter === i ? {background: src.color} : {})}>{src.name ? src.name.substring(0, 3) : "S" + (i + 1)}</button>; })}
        </div>
      </div>
      <div style={{display: "flex", gap: 3, overflowX: "auto", padding: "4px 0", WebkitOverflowScrolling: "touch"}}>
        {visiblePalette.map(function(tile) {
          var isSel = selected && selected.key === tile.key;
          return <div key={tile.key} onClick={function(){setSelected(tile); setTool("place")}}
            style={{minWidth: 48, width: 48, height: 48, borderRadius: 4, overflow: "hidden", cursor: "pointer", border: isSel ? "2px solid #fff" : "2px solid " + (sources[tile.srcIdx] ? sources[tile.srcIdx].color : "#333"), flexShrink: 0, position: "relative"}}>
            <img src={tile.dataUrl} style={{width: "100%", height: "100%", objectFit: "cover", display: "block"}} alt="" />
          </div>;
        })}
      </div>
      {selected && <p style={{fontSize: "0.62rem", color: "#6ee7b7", marginTop: 3}}>{"Selected: " + selected.key}</p>}
    </div>}

    {/* TOOLBAR */}
    <div style={S.card}>
      <div style={{display: "flex", gap: 4, marginBottom: 8}}>
        {TOOLS.map(function(t) {
          return <button key={t} onClick={function(){setTool(t); if (t !== "swap") setSwapFirst(null);}}
            style={Object.assign({}, S.btn, {flex: 1, fontSize: "0.76rem", padding: 9, background: tool === t ? TOOL_COLORS[t] : "#1e1e2e", color: tool === t ? "#fff" : "#888"})}>
            {TOOL_LABELS[t]}{t === "swap" && swapFirst !== null ? " *" : ""}
          </button>;
        })}
      </div>
      <div style={{display: "flex", gap: 6, alignItems: "center", marginBottom: 6}}>
        <p style={{fontSize: "0.72rem", color: "#888", whiteSpace: "nowrap"}}>Grid:</p>
        <input type="number" value={gridW} onChange={function(e){resizeGrid(+e.target.value, gridH)}} style={Object.assign({}, S.si, {width: 50})} />
        <span style={{color: "#555"}}>x</span>
        <input type="number" value={gridH} onChange={function(e){resizeGrid(gridW, +e.target.value)}} style={Object.assign({}, S.si, {width: 50})} />
        <p style={{fontSize: "0.6rem", color: "#666"}}>{"= " + (gridW * gridH) + "/" + MAX_TILES}</p>
      </div>
      <div style={{display: "flex", gap: 6, alignItems: "center"}}>
        <p style={{fontSize: "0.72rem", color: "#888"}}>Zoom:</p>
        {[0.25, 0.5, 1].map(function(z) { return <button key={z} onClick={function(){setGridZoom(z)}} style={Object.assign({}, S.sm, gridZoom === z ? {background: "#3b82f6"} : {})}>{z + "x"}</button>; })}
        <div style={{flex: 1}} />
        <p style={{fontSize: "0.62rem", color: "#6ee7b7"}}>{filledCount + "/" + (gridW * gridH) + " filled"}</p>
      </div>
    </div>

    {/* GRID */}
    <div style={Object.assign({}, S.card, {padding: 4, overflow: "auto", WebkitOverflowScrolling: "touch", maxHeight: "60vh"})}>
      <div style={{display: "grid", gridTemplateColumns: "repeat(" + gridW + ", " + Math.round(64 * gridZoom) + "px)", gap: 1, background: "#111", width: "fit-content"}}>
        {grid.map(function(cell, idx) {
          var gx = idx % gridW, gy = Math.floor(idx / gridW);
          var cellSize = Math.round(64 * gridZoom);
          var isSS = (tool === "swap" && swapFirst === idx);
          return <div key={idx} onClick={function(){onCellClick(idx)}}
            style={{width: cellSize, height: cellSize, background: cell ? "transparent" : "#0a0a0f", border: isSS ? "2px solid #f59e0b" : "1px solid #1a1a2a", cursor: "pointer", position: "relative", overflow: "hidden", boxSizing: "border-box"}}>
            {cell && <img src={cell.dataUrl} style={{width: "100%", height: "100%", objectFit: "cover", display: "block"}} alt="" />}
            {!cell && gridZoom >= 0.5 && <span style={{position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: "0.4rem", color: "#222"}}>{gx + "," + gy}</span>}
            {cell && cell.srcIdx !== undefined && sources[cell.srcIdx] && <div style={{position: "absolute", top: 0, right: 0, width: 5, height: 5, borderRadius: "0 0 0 3px", background: sources[cell.srcIdx].color}} />}
          </div>;
        })}
      </div>
    </div>

    {/* ACTIONS */}
    <div style={Object.assign({}, S.card, {display: "flex", gap: 6, flexWrap: "wrap"})}>
      <button onClick={downloadGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 110, background: "#059669"})}>Download PNG</button>
      <button onClick={clearGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 110, background: "#7f1d1d"})}>Clear Grid</button>
    </div>
    {dlStatus && <p style={Object.assign({}, S.st, {textAlign: "center"})}>{dlStatus}</p>}
  </>;
}

var S = {
  card: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 10 },
  sec: { fontSize: "0.82rem", fontWeight: 600, color: "#fbbf24", marginBottom: 4 },
  input: { width: "100%", padding: 9, background: "#0d0d14", border: "1px solid #333", borderRadius: 7, color: "#eee", fontSize: "0.76rem", marginBottom: 6, boxSizing: "border-box" },
  si: { padding: 7, background: "#0d0d14", border: "1px solid #333", borderRadius: 6, color: "#eee", fontSize: "0.74rem", boxSizing: "border-box" },
  btn: { display: "block", padding: 10, border: "none", borderRadius: 7, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", color: "#fff", textAlign: "center" },
  sm: { padding: "4px 8px", border: "none", borderRadius: 5, fontSize: "0.68rem", fontWeight: 600, cursor: "pointer", color: "#ddd", background: "#2a2a3a" },
  toggle: { width: "100%", padding: 7, borderRadius: 6, color: "#fff", border: "none", cursor: "pointer", textAlign: "center", fontSize: "0.74rem", fontWeight: 600 },
  off: { background: "#555", cursor: "not-allowed" },
  st: { fontSize: "0.72rem", color: "#fbbf24", marginTop: 6 },
  ml: { fontSize: "0.6rem", color: "#888", marginBottom: 2 },
  g5: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 5, marginTop: 6 },
  bar: { width: "100%", height: 5, background: "#1e1e2e", borderRadius: 3, marginTop: 6, overflow: "hidden" },
  fill: { height: "100%", background: "#3b82f6", borderRadius: 3, transition: "width 0.3s" },
  stab: { flex: 1, padding: "6px 4px", border: "1px solid #333", borderRadius: 6, background: "#1e1e2e", color: "#888", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" },
};
