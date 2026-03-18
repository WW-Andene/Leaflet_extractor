import { useState, useRef, useCallback } from "react";

var MAX_TILES = 8192;

var COORD_ORDERS = ["zxy", "zyx", "xzy", "xyz", "yzx", "yxz"];

function buildUrl(pat, z, x, y, order) {
  var o = order || "zxy";
  var v = { z: z, x: x, y: y };
  return pat.replace("{z}", v[o[0]]).replace("{x}", v[o[1]]).replace("{y}", v[o[2]]);
}
function tileKey(src, x, y) { return src + ":" + x + "," + y; }

// Store tiles as blob URLs — keeps original format (webp/jpg), no re-encoding
function loadTileAsBlob(src) {
  return new Promise(function(res) {
    fetch(src).then(function(r) {
      if (!r.ok) { res(null); return; }
      return r.blob();
    }).then(function(blob) {
      if (!blob || blob.size === 0) { res(null); return; }
      res({ blobUrl: URL.createObjectURL(blob), size: blob.size });
    }).catch(function() { res(null); });
  });
}
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function emptySource() {
  return { name: "", pattern: "", zoom: 3, minX: 0, maxX: 7, minY: 0, maxY: 7,
    tileSize: 256, color: COLORS[0], swapXY: false, transpose: false, flipX: false, flipY: false };
}
var COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b"];
var TOOLS = ["hand", "place", "paint", "pick", "swap", "box", "erase"];
var TOOL_LABELS = { hand: "\u270B", place: "Place", paint: "Paint", pick: "Pick", swap: "Swap", box: "Box", erase: "Erase" };
var TOOL_COLORS = { hand: "#666", place: "#3b82f6", paint: "#2563eb", pick: "#8b5cf6", swap: "#f59e0b", box: "#059669", erase: "#ef4444" };

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
  // Fixed grid: 90x90 = 8100 tiles (max 8192)
  var GRID_W = 90, GRID_H = 90;
  a = s(GRID_W); var gridW = a[0], setGridW = a[1];
  a = s(GRID_H); var gridH = a[0], setGridH = a[1];
  a = s(function() { return new Array(GRID_W * GRID_H).fill(null); });
  var grid = a[0], setGrid = a[1];
  a = s("hand"); var tool = a[0], setTool = a[1];
  a = s(null); var selected = a[0], setSelected = a[1];
  a = s(null); var swapFirst = a[0], setSwapFirst = a[1];
  a = s(-1); var paletteFilter = a[0], setPaletteFilter = a[1];
  a = s([]); var paletteTiles = a[0], setPaletteTiles = a[1];
  a = s(0.1); var gridZoom = a[0], setGridZoom = a[1];
  a = s(""); var dlStatus = a[0], setDlStatus = a[1];
  a = s(""); var sampleUrl = a[0], setSampleUrl = a[1];
  a = s(false); var detecting = a[0], setDetecting = a[1];
  a = s(null); var srcPreview = a[0], setSrcPreview = a[1];
  a = s(null); var boxFirst = a[0], setBoxFirst = a[1]; // box fill first corner
  var paintingRef = useRef(false); // drag-to-paint active
  a = s("jpeg"); var dlFormat = a[0], setDlFormat = a[1]; // jpeg or png
  a = s(1); var dlScale = a[0], setDlScale = a[1]; // 0.5 or 1

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
    Object.keys(bank).forEach(function(k) {
      if (k.startsWith(idx + ":")) { try { URL.revokeObjectURL(bank[k]); } catch(e){} delete bank[k]; }
    });
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

  async function showSrcPreview(idx) {
    var src = sources[idx]; if (!src.pattern) return;
    setLoadStatus("Loading 4x4 preview...");
    var cx = Math.round((src.minX + src.maxX) / 2), cy = Math.round((src.minY + src.maxY) / 2);
    var tiles = [];
    for (var dy = -1; dy <= 2; dy++) {
      for (var dx = -1; dx <= 2; dx++) {
        var x = cx + dx, y = cy + dy;
        var rawUrl = buildUrl(src.pattern, src.zoom, x, y, src.swapXY);
        tiles.push({ x: x, y: y, rawUrl: rawUrl, url: "/api/tile-proxy?url=" + encodeURIComponent(rawUrl), label: "x=" + x + " y=" + y });
      }
    }
    var checks = await Promise.all(tiles.map(function(t) {
      return fetch("/api/tile-proxy?check=1&url=" + encodeURIComponent(t.rawUrl))
        .then(function(r) { return r.json(); })
        .catch(function() { return { ok: false, size: 0 }; });
    }));
    var rows = [];
    for (var i = 0; i < 4; i++) {
      var row = [];
      for (var j = 0; j < 4; j++) {
        var ti = i * 4 + j;
        tiles[ti].size = checks[ti].size || 0;
        tiles[ti].exists = checks[ti].ok && checks[ti].size > 100;
        row.push(tiles[ti]);
      }
      rows.push(row);
    }
    var loaded = tiles.filter(function(t) { return t.exists; }).length;
    setLoadStatus("4x4: " + loaded + "/16 tiles have content. Red = empty/placeholder.");
    setSrcPreview({ rows: rows, srcIdx: idx });
  }

  // Track actual memory usage
  var bankSizeRef = useRef(0);

  // --- LOAD WITH ABORT ---
  async function loadSource(idx) {
    var src = sources[idx];
    if (!src.pattern || loadingSrc) return;
    var cols = src.maxX - src.minX + 1, rows = src.maxY - src.minY + 1, total = cols * rows;
    abortRef.current = false;
    setLoadingSrc(true); setLoadProgress(0);
    var bank = bankRef.current;
    setLoadStatus("Loading " + total + " tiles...");
    var done = 0, failed = 0;
    for (var y = src.minY; y <= src.maxY; y++) {
      for (var x = src.minX; x <= src.maxX; x++) {
        if (abortRef.current) {
          setLoadStatus("Stopped! " + done + "/" + total + " (" + failed + " failed) | " + formatMB(bankSizeRef.current));
          setLoadingSrc(false); rebuildPalette(); return;
        }
        var key = tileKey(idx, x, y);
        if (bank[key]) { done++; setLoadProgress(Math.round(((done + failed) / total) * 100)); continue; }
        var rawUrl = buildUrl(src.pattern, src.zoom, x, y, src.swapXY);
        var result = await loadTileAsBlob("/api/tile-proxy?url=" + encodeURIComponent(rawUrl));
        if (result) { bank[key] = result.blobUrl; bankSizeRef.current += result.size; done++; }
        else failed++;
        setLoadProgress(Math.round(((done + failed) / total) * 100));
        if ((done + failed) % 10 === 0 || done + failed === total) {
          setLoadStatus("Loading: " + (done + failed) + "/" + total + " (" + failed + " failed) | " + formatMB(bankSizeRef.current));
        }
        await wait(100);
      }
    }
    rebuildPalette();
    setLoadStatus("Loaded " + done + "/" + total + (failed > 0 ? " (" + failed + " failed)" : "") + " | " + formatMB(bankSizeRef.current));
    setLoadingSrc(false);
  }

  function formatMB(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + "MB"; }

  function stopLoading() { abortRef.current = true; }

  function autoPlace(idx) {
    var src = sources[idx]; var bank = bankRef.current;
    var srcCols = src.maxX - src.minX + 1, srcRows = src.maxY - src.minY + 1;
    var placeCols = src.transpose ? srcRows : srcCols;
    var placeRows = src.transpose ? srcCols : srcRows;
    var W = gridW, H = gridH;

    // Scan existing content bounding box
    var hasContent = false;
    var exMinX = W, exMaxX = 0, exMinY = H, exMaxY = 0;
    for (var i = 0; i < grid.length; i++) {
      if (grid[i]) {
        var cx = i % W, cy = Math.floor(i / W);
        hasContent = true;
        if (cx < exMinX) exMinX = cx;
        if (cx > exMaxX) exMaxX = cx;
        if (cy < exMinY) exMinY = cy;
        if (cy > exMaxY) exMaxY = cy;
      }
    }

    // Calculate offset
    var offX, offY;
    if (!hasContent) {
      // Center in grid
      offX = Math.max(0, Math.floor((W - placeCols) / 2));
      offY = Math.max(0, Math.floor((H - placeRows) / 2));
    } else {
      // Try right side (1-tile gap from existing content)
      offX = exMaxX + 2;
      offY = Math.max(0, Math.floor((exMinY + exMaxY) / 2 - placeRows / 2)); // vertically centered with existing
      // If it doesn't fit on the right, try below
      if (offX + placeCols > W) {
        offX = Math.max(0, Math.floor((exMinX + exMaxX) / 2 - placeCols / 2)); // horizontally centered with existing
        offY = exMaxY + 2;
      }
      // If it doesn't fit below either, place at first available corner
      if (offY + placeRows > H) {
        offX = 0; offY = 0;
      }
    }

    // Clamp to grid bounds
    offX = Math.min(offX, Math.max(0, W - placeCols));
    offY = Math.min(offY, Math.max(0, H - placeRows));

    // Place tiles into existing grid (no resize)
    var ng = grid.slice();
    for (var dy = 0; dy < srcRows; dy++) for (var dx = 0; dx < srcCols; dx++) {
      var tileX = src.minX + dx, tileY = src.minY + dy;
      var key = tileKey(idx, tileX, tileY); if (!bank[key]) continue;
      var rawGx = src.transpose ? dy : dx;
      var rawGy = src.transpose ? dx : dy;
      var maxGx = src.transpose ? (srcRows - 1) : (srcCols - 1);
      var maxGy = src.transpose ? (srcCols - 1) : (srcRows - 1);
      var gx2 = src.flipX ? (maxGx - rawGx) : rawGx;
      var gy2 = src.flipY ? (maxGy - rawGy) : rawGy;
      var finalX = offX + gx2, finalY = offY + gy2;
      if (finalX >= 0 && finalX < W && finalY >= 0 && finalY < H) {
        ng[finalY * W + finalX] = { key: key, dataUrl: bank[key], srcIdx: idx, ox: tileX, oy: tileY };
      }
    }
    setGrid(ng);
  }

  // Paint a single cell (used by paint drag and place)
  function paintCell(idx) {
    if (!selected) return;
    setGrid(function(old) { var ng = old.slice(); ng[idx] = Object.assign({}, selected); return ng; });
  }

  function onCellClick(idx) {
    if (tool === "hand") return;
    if (tool === "place") { paintCell(idx); }
    else if (tool === "paint") { paintCell(idx); }
    else if (tool === "pick") { var cell = grid[idx]; if (cell) { setSelected(Object.assign({}, cell)); setTool("place"); } }
    else if (tool === "swap") { if (swapFirst === null) setSwapFirst(idx); else { setGrid(function(old) { var ng = old.slice(); var tmp = ng[swapFirst]; ng[swapFirst] = ng[idx]; ng[idx] = tmp; return ng; }); setSwapFirst(null); } }
    else if (tool === "box") {
      if (boxFirst === null) { setBoxFirst(idx); }
      else {
        // Fill rectangle between boxFirst and idx
        if (!selected) { setBoxFirst(null); return; }
        var x1 = boxFirst % gridW, y1 = Math.floor(boxFirst / gridW);
        var x2 = idx % gridW, y2 = Math.floor(idx / gridW);
        var minGx = Math.min(x1, x2), maxGx = Math.max(x1, x2);
        var minGy = Math.min(y1, y2), maxGy = Math.max(y1, y2);
        setGrid(function(old) {
          var ng = old.slice();
          for (var gy = minGy; gy <= maxGy; gy++)
            for (var gx = minGx; gx <= maxGx; gx++)
              ng[gy * gridW + gx] = Object.assign({}, selected);
          return ng;
        });
        setBoxFirst(null);
      }
    }
    else if (tool === "erase") { setGrid(function(old) { var ng = old.slice(); ng[idx] = null; return ng; }); }
  }

  // Drag-to-paint: mouse/touch move handler
  function onCellEnter(idx) {
    if (tool === "paint" && paintingRef.current && selected) {
      paintCell(idx);
    } else if (tool === "erase" && paintingRef.current) {
      setGrid(function(old) { var ng = old.slice(); ng[idx] = null; return ng; });
    }
  }

  function onGridPointerDown() { paintingRef.current = true; }
  function onGridPointerUp() { paintingRef.current = false; }

  async function downloadGrid() {
    var tSize = sources[activeSrc] ? sources[activeSrc].tileSize : 256;
    var scale = dlScale;
    var fmt = dlFormat;

    // Find bounding box
    var bMinX = gridW, bMaxX = 0, bMinY = gridH, bMaxY = 0;
    var filled = [];
    for (var i = 0; i < grid.length; i++) {
      if (grid[i]) {
        var gx = i % gridW, gy = Math.floor(i / gridW);
        if (gx < bMinX) bMinX = gx; if (gx > bMaxX) bMaxX = gx;
        if (gy < bMinY) bMinY = gy; if (gy > bMaxY) bMaxY = gy;
        filled.push({ cell: grid[i], gx: gx, gy: gy });
      }
    }
    if (filled.length === 0) { setDlStatus("Grid is empty!"); return; }

    var cropW = bMaxX - bMinX + 1, cropH = bMaxY - bMinY + 1;
    var scaledTile = Math.round(tSize * scale);
    var W = cropW * scaledTile, H = cropH * scaledTile;

    // Build tile list with original coordinates for server
    var tileList = [];
    for (var j = 0; j < filled.length; j++) {
      var f = filled[j];
      var c = f.cell;
      tileList.push({
        srcIdx: c.srcIdx || 0,
        x: c.ox, y: c.oy,
        gx: f.gx - bMinX, gy: f.gy - bMinY,
      });
    }

    // Build patterns array from sources
    var pats = sources.map(function(src) {
      return { pattern: src.pattern, zoom: src.zoom, swapXY: src.swapXY };
    });

    setDlStatus("Server rendering " + W + "x" + H + "px (" + filled.length + " tiles, " + fmt.toUpperCase() + " " + scale + "x)...");

    try {
      var resp = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patterns: pats,
          tiles: tileList,
          tileSize: tSize,
          scale: scale,
          cropW: cropW,
          cropH: cropH,
          format: fmt,
          quality: 92,
        }),
      });

      if (!resp.ok) {
        var err = "";
        try { var ej = await resp.json(); err = ej.error || resp.status; } catch(e) { err = resp.status; }
        setDlStatus("Server error: " + err);
        return;
      }

      var blob = await resp.blob();
      var sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      var ext = fmt === "jpeg" ? "jpg" : "png";
      var blobUrl = URL.createObjectURL(blob);
      var dl = document.createElement("a");
      dl.href = blobUrl;
      dl.download = "tilemap_" + W + "x" + H + "." + ext;
      dl.click();
      setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 5000);
      setDlStatus("Downloaded " + W + "x" + H + "px | " + sizeMB + "MB " + fmt.toUpperCase() + " (" + filled.length + " tiles)");
    } catch (e) {
      setDlStatus("Render failed: " + e.message);
    }
  }

  function clearGrid() { setGrid(new Array(GRID_W * GRID_H).fill(null)); setSwapFirst(null); }
  function clearBank() {
    var bank = bankRef.current;
    Object.keys(bank).forEach(function(k) { try { URL.revokeObjectURL(bank[k]); } catch(e){} });
    bankRef.current = {};
    bankSizeRef.current = 0;
    setPaletteTiles([]); setSelected(null);
    setLoadStatus("Bank cleared — all blob URLs revoked");
  }
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
            <div><p style={S.ml}>Swap XY</p><button onClick={toggleSrc("swapXY")} style={Object.assign({}, S.toggle, {background: src.swapXY ? "#d97706" : "#333"})}>{src.swapXY ? "ON" : "OFF"}</button></div>
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
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2, background: "#000", borderRadius: 6, overflow: "hidden"}}>
        {srcPreview.rows.flat().map(function(tile, i) {
          return <div key={i} style={{position: "relative", background: "#0a0a0f", border: tile.exists ? "2px solid #059669" : "2px solid #dc2626"}}>
            {tile.exists && <img src={tile.url} style={{width: "100%", display: "block"}} alt={tile.label} onError={function(e){e.target.style.opacity = 0.1}} />}
            {!tile.exists && <div style={{width: "100%", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", fontSize: "1.1rem", fontWeight: 700}}>X</div>}
            <div style={{position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", color: tile.exists ? "#6ee7b7" : "#f87171", fontSize: "0.38rem", padding: "1px 2px", textAlign: "center"}}>{tile.label + " " + (tile.size > 0 ? Math.round(tile.size / 1024) + "K" : "0")}</div>
          </div>;
        })}
      </div>
    </div>}

    {/* PALETTE */}
    {paletteTiles.length > 0 && <div style={S.card}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
        <p style={S.sec}>{"Palette (" + paletteTiles.length + " tiles | " + formatMB(bankSizeRef.current) + ")"}</p>
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
          return <button key={t} onClick={function(){setTool(t); if (t !== "swap") setSwapFirst(null); if (t !== "box") setBoxFirst(null);}}
            style={Object.assign({}, S.btn, {flex: 1, fontSize: "0.76rem", padding: 9, background: tool === t ? TOOL_COLORS[t] : "#1e1e2e", color: tool === t ? "#fff" : "#888"})}>
            {TOOL_LABELS[t]}{t === "swap" && swapFirst !== null ? " *" : ""}{t === "box" && boxFirst !== null ? " *" : ""}
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
        {[0.05, 0.1, 0.25, 0.5, 1].map(function(z) { return <button key={z} onClick={function(){setGridZoom(z)}} style={Object.assign({}, S.sm, gridZoom === z ? {background: "#3b82f6"} : {})}>{z + "x"}</button>; })}
        <div style={{flex: 1}} />
        <p style={{fontSize: "0.62rem", color: "#6ee7b7"}}>{filledCount + "/" + (gridW * gridH) + " filled"}</p>
      </div>
    </div>

    {/* GRID */}
    <div style={Object.assign({}, S.card, {padding: 4, overflow: "auto", WebkitOverflowScrolling: "touch", maxHeight: "60vh", touchAction: (tool === "paint" || tool === "erase") ? "none" : "auto"})}
      onPointerDown={tool !== "hand" ? onGridPointerDown : undefined} onPointerUp={tool !== "hand" ? onGridPointerUp : undefined} onPointerLeave={tool !== "hand" ? onGridPointerUp : undefined}>
      <div style={{display: "grid", gridTemplateColumns: "repeat(" + gridW + ", " + Math.max(2, Math.round(64 * gridZoom)) + "px)", gap: gridZoom <= 0.1 ? 0 : 1, background: "#111", width: "fit-content"}}>
        {grid.map(function(cell, idx) {
          var gx = idx % gridW, gy = Math.floor(idx / gridW);
          var cellSize = Math.max(2, Math.round(64 * gridZoom));
          var isSS = (tool === "swap" && swapFirst === idx) || (tool === "box" && boxFirst === idx);
          var isHand = tool === "hand";
          if (gridZoom <= 0.1) {
            return <div key={idx}
              onPointerDown={isHand ? undefined : function(){onCellClick(idx)}}
              onPointerEnter={isHand ? undefined : function(){onCellEnter(idx)}}
              style={{width: cellSize, height: cellSize, cursor: isHand ? "grab" : "pointer", boxSizing: "border-box",
                pointerEvents: isHand ? "none" : "auto",
                background: cell ? (sources[cell.srcIdx] ? sources[cell.srcIdx].color : "#3b82f6") : "#0a0a0f",
                border: isSS ? "1px solid #f59e0b" : "none"}} />;
          }
          return <div key={idx}
            onPointerDown={isHand ? undefined : function(){onCellClick(idx)}}
            onPointerEnter={isHand ? undefined : function(){onCellEnter(idx)}}
            style={{width: cellSize, height: cellSize, background: cell ? "transparent" : "#0a0a0f",
              border: isSS ? "2px solid #f59e0b" : (gridZoom >= 0.5 ? "1px solid #1a1a2a" : "none"),
              cursor: isHand ? "grab" : "pointer", position: "relative", overflow: "hidden", boxSizing: "border-box",
              pointerEvents: isHand ? "none" : "auto"}}>
            {cell && <img src={cell.dataUrl} draggable="false" style={{width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none"}} alt="" />}
            {!cell && gridZoom >= 0.5 && <span style={{position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: "0.4rem", color: "#222"}}>{gx + "," + gy}</span>}
            {cell && gridZoom >= 0.25 && cell.srcIdx !== undefined && sources[cell.srcIdx] && <div style={{position: "absolute", top: 0, right: 0, width: 5, height: 5, borderRadius: "0 0 0 3px", background: sources[cell.srcIdx].color}} />}
          </div>;
        })}
      </div>
    </div>

    {/* DOWNLOAD OPTIONS */}
    <div style={S.card}>
      <div style={{display: "flex", gap: 6, alignItems: "center", marginBottom: 8}}>
        <p style={{fontSize: "0.72rem", color: "#888"}}>Format:</p>
        {["jpeg", "png"].map(function(f) {
          return <button key={f} onClick={function(){setDlFormat(f)}}
            style={Object.assign({}, S.sm, dlFormat === f ? {background: "#3b82f6"} : {})}>{f.toUpperCase()}</button>;
        })}
        <p style={{fontSize: "0.72rem", color: "#888", marginLeft: 8}}>Scale:</p>
        {[0.5, 1, 2, 3, 4].map(function(sc) {
          return <button key={sc} onClick={function(){setDlScale(sc)}}
            style={Object.assign({}, S.sm, dlScale === sc ? {background: "#3b82f6"} : {})}>{sc + "x"}</button>;
        })}
      </div>
      {(function() {
        // Preview output dimensions
        var bMnX = gridW, bMxX = 0, bMnY = gridH, bMxY = 0, cnt = 0;
        for (var ii = 0; ii < grid.length; ii++) {
          if (grid[ii]) { var ggx = ii % gridW, ggy = Math.floor(ii / gridW); cnt++;
            if (ggx < bMnX) bMnX = ggx; if (ggx > bMxX) bMxX = ggx;
            if (ggy < bMnY) bMnY = ggy; if (ggy > bMxY) bMxY = ggy; }
        }
        if (cnt === 0) return null;
        var ts = sources[activeSrc] ? sources[activeSrc].tileSize : 256;
        var ow = (bMxX - bMnX + 1) * Math.round(ts * dlScale);
        var oh = (bMxY - bMnY + 1) * Math.round(ts * dlScale);
        var warn = ow > 30000 || oh > 30000;
        var slow = cnt > 1000;
        return <p style={{fontSize: "0.65rem", color: warn ? "#ef4444" : slow ? "#f59e0b" : "#666", marginTop: 4, marginBottom: 8}}>
          {"Output: " + ow + "x" + oh + "px (" + cnt + " tiles, server render)" + (warn ? " — exceeds 30000px limit" : "") + (slow && !warn ? " — large, may take 30-60s" : "")}
        </p>;
      })()}
      <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
        <button onClick={downloadGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 90, background: "#059669"})}>Download</button>
        <button onClick={clearGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 90, background: "#7f1d1d"})}>Clear Grid</button>
        <button onClick={clearBank} style={Object.assign({}, S.btn, {flex: 1, minWidth: 90, background: "#991b1b"})}>Clear Bank</button>
      </div>
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
