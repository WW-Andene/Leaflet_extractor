import { useState, useRef, useCallback } from "react";

/*
  Tile Editor - Multi-source tile compositor
  - Up to 4 source slots with per-source Swap XY / Flip X / Flip Y
  - Supports standard {z}/{x}/{y} and appsample {z}/tile-{x}_{y} formats
  - Tiles stored as dataURLs (persist across source switches)
  - Place, pick, swap, duplicate, erase on editor grid
  - Max 8192 total tiles in editor grid
*/

var MAX_TILES = 8192; // max total tiles in editor grid

function buildUrl(pat, z, x, y, swapXY) {
  if (swapXY) return pat.replace("{z}", z).replace("{x}", y).replace("{y}", x);
  return pat.replace("{z}", z).replace("{x}", x).replace("{y}", y);
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
    tileSize: 256, color: COLORS[0], swapXY: false, flipX: false, flipY: false };
}

var COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b"];
var TOOLS = ["place", "pick", "swap", "erase"];
var TOOL_LABELS = { place: "Place", pick: "Pick", swap: "Swap", erase: "Erase" };
var TOOL_COLORS = { place: "#3b82f6", pick: "#8b5cf6", swap: "#f59e0b", erase: "#ef4444" };

export default function Editor() {
  var s = useState, a;

  // Sources
  a = s([Object.assign(emptySource(), { name: "Source 1", color: COLORS[0] })]);
  var sources = a[0], setSources = a[1];
  a = s(0); var activeSrc = a[0], setActiveSrc = a[1];

  // Tile bank: key -> dataURL
  var bankRef = useRef({});

  // Loading
  a = s(false); var loadingSrc = a[0], setLoadingSrc = a[1];
  a = s(""); var loadStatus = a[0], setLoadStatus = a[1];
  a = s(0); var loadProgress = a[0], setLoadProgress = a[1];

  // Editor grid
  a = s(16); var gridW = a[0], setGridW = a[1];
  a = s(16); var gridH = a[0], setGridH = a[1];
  a = s(function() { return new Array(16 * 16).fill(null); });
  var grid = a[0], setGrid = a[1];

  // Tool
  a = s("place"); var tool = a[0], setTool = a[1];
  a = s(null); var selected = a[0], setSelected = a[1];
  a = s(null); var swapFirst = a[0], setSwapFirst = a[1];

  // Palette
  a = s(-1); var paletteFilter = a[0], setPaletteFilter = a[1];
  a = s([]); var paletteTiles = a[0], setPaletteTiles = a[1];

  // Grid zoom
  a = s(1); var gridZoom = a[0], setGridZoom = a[1];

  // Download
  a = s(""); var dlStatus = a[0], setDlStatus = a[1];

  // Sample URL for detect
  a = s(""); var sampleUrl = a[0], setSampleUrl = a[1];
  a = s(false); var detecting = a[0], setDetecting = a[1];

  // Rebuild palette from bank
  var rebuildPalette = useCallback(function() {
    var bank = bankRef.current;
    var items = [];
    var keys = Object.keys(bank);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var parts = k.split(":");
      var srcIdx = parseInt(parts[0]);
      var coords = parts[1].split(",");
      if (bank[k]) {
        items.push({ key: k, dataUrl: bank[k], srcIdx: srcIdx, ox: parseInt(coords[0]), oy: parseInt(coords[1]) });
      }
    }
    items.sort(function(a2, b) {
      if (a2.srcIdx !== b.srcIdx) return a2.srcIdx - b.srcIdx;
      if (a2.oy !== b.oy) return a2.oy - b.oy;
      return a2.ox - b.ox;
    });
    setPaletteTiles(items);
  }, []);

  // Resize grid preserving content
  function resizeGrid(newW, newH) {
    var w = Math.max(newW, 1);
    var h = Math.max(newH, 1);
    if (w * h > MAX_TILES) return; // over limit, reject
    setGrid(function(old) {
      var oldW = gridW;
      var ng = new Array(w * h).fill(null);
      for (var gy = 0; gy < h; gy++) {
        for (var gx = 0; gx < w; gx++) {
          if (gx < oldW && gy < Math.floor(old.length / oldW)) {
            ng[gy * w + gx] = old[gy * oldW + gx];
          }
        }
      }
      return ng;
    });
    setGridW(w);
    setGridH(h);
  }

  // Update source field
  function updateSource(idx, field, val) {
    setSources(function(prev) {
      var n = prev.slice();
      n[idx] = Object.assign({}, n[idx]);
      n[idx][field] = val;
      return n;
    });
  }

  // Add source
  function addSource() {
    if (sources.length >= 4) return;
    setSources(function(prev) {
      return prev.concat([Object.assign(emptySource(), { name: "Source " + (prev.length + 1), color: COLORS[prev.length % 4] })]);
    });
  }

  // Remove source
  function removeSource(idx) {
    var bank = bankRef.current;
    var prefix = idx + ":";
    Object.keys(bank).forEach(function(k) { if (k.startsWith(prefix)) delete bank[k]; });
    setGrid(function(old) {
      return old.map(function(cell) { return cell && cell.srcIdx === idx ? null : cell; });
    });
    setSources(function(prev) { var n = prev.slice(); n.splice(idx, 1); return n; });
    if (activeSrc >= sources.length - 1) setActiveSrc(Math.max(0, sources.length - 2));
    rebuildPalette();
  }

  // Auto-detect from sample tile URL
  async function detectSource() {
    if (!sampleUrl || detecting) return;
    setDetecting(true);
    setLoadStatus("Detecting pattern and bounds...");
    try {
      var r = await fetch("/api/probe?sampleTile=" + encodeURIComponent(sampleUrl));
      var d = await r.json();
      if (d.success) {
        updateSource(activeSrc, "pattern", d.pattern);
        updateSource(activeSrc, "zoom", d.detectedZoom);
        if (d.bounds) {
          updateSource(activeSrc, "minX", d.bounds.minX);
          updateSource(activeSrc, "maxX", d.bounds.maxX);
          updateSource(activeSrc, "minY", d.bounds.minY);
          updateSource(activeSrc, "maxY", d.bounds.maxY);
        }
        var cols = d.bounds ? (d.bounds.maxX - d.bounds.minX + 1) : 0;
        var rows = d.bounds ? (d.bounds.maxY - d.bounds.minY + 1) : 0;
        setLoadStatus("Detected! " + cols + "x" + rows + " tiles at zoom " + d.detectedZoom + " (" + d.format + " format)");
      } else {
        setLoadStatus("Detection failed: " + (d.error || "unknown"));
      }
    } catch (e) { setLoadStatus("Error: " + e.message); }
    setDetecting(false);
  }

  // Load tiles from source into bank
  async function loadSource(idx) {
    var src = sources[idx];
    if (!src.pattern || loadingSrc) return;
    setLoadingSrc(true); setLoadProgress(0);
    var bank = bankRef.current;
    var cols = src.maxX - src.minX + 1;
    var rows = src.maxY - src.minY + 1;
    var total = cols * rows;
    setLoadStatus("Loading " + total + " tiles from " + (src.name || "Source " + (idx + 1)) + "...");
    var done = 0, failed = 0;
    for (var y = src.minY; y <= src.maxY; y++) {
      for (var x = src.minX; x <= src.maxX; x++) {
        var key = tileKey(idx, x, y);
        if (bank[key]) { done++; setLoadProgress(Math.round(((done + failed) / total) * 100)); continue; }
        var rawUrl = buildUrl(src.pattern, src.zoom, x, y, src.swapXY);
        var proxiedUrl = "/api/tile-proxy?url=" + encodeURIComponent(rawUrl);
        var dataUrl = await loadImgAsDataUrl(proxiedUrl);
        if (dataUrl) { bank[key] = dataUrl; done++; }
        else { failed++; }
        setLoadProgress(Math.round(((done + failed) / total) * 100));
        setLoadStatus("Loading: " + (done + failed) + "/" + total + " (" + failed + " failed)");
        await wait(150);
      }
    }
    bankRef.current = bank;
    rebuildPalette();
    setLoadStatus("Loaded " + done + "/" + total + (failed > 0 ? " (" + failed + " failed)" : " - all OK!"));
    setLoadingSrc(false);
  }

  // Auto-place tiles from source into grid (respects flipX/flipY)
  function autoPlace(idx) {
    var src = sources[idx];
    var bank = bankRef.current;
    var cols = src.maxX - src.minX + 1;
    var rows = src.maxY - src.minY + 1;
    var newW = Math.max(gridW, cols);
    var newH = Math.max(gridH, rows);
    if (newW * newH > MAX_TILES) { newW = cols; newH = rows; } // fit source at minimum
    setGrid(function(old) {
      var oldW = gridW;
      var ng = new Array(newW * newH).fill(null);
      // Preserve old cells
      for (var gy = 0; gy < newH; gy++) {
        for (var gx = 0; gx < newW; gx++) {
          if (gx < oldW && gy < Math.floor(old.length / oldW)) {
            ng[gy * newW + gx] = old[gy * oldW + gx];
          }
        }
      }
      // Place from source with flip support
      for (var dy = 0; dy < rows; dy++) {
        for (var dx = 0; dx < cols; dx++) {
          var tileX = src.minX + dx;
          var tileY = src.minY + dy;
          var key = tileKey(idx, tileX, tileY);
          if (bank[key]) {
            var gx2 = src.flipX ? (cols - 1 - dx) : dx;
            var gy2 = src.flipY ? (rows - 1 - dy) : dy;
            var gi = gy2 * newW + gx2;
            if (gi < ng.length) {
              ng[gi] = { key: key, dataUrl: bank[key], srcIdx: idx, ox: tileX, oy: tileY };
            }
          }
        }
      }
      return ng;
    });
    setGridW(newW);
    setGridH(newH);
  }

  // Grid cell click
  function onCellClick(idx) {
    if (tool === "place") {
      if (!selected) return;
      setGrid(function(old) {
        var ng = old.slice();
        ng[idx] = Object.assign({}, selected);
        return ng;
      });
    } else if (tool === "pick") {
      var cell = grid[idx];
      if (cell) {
        setSelected(Object.assign({}, cell));
        setTool("place");
      }
    } else if (tool === "swap") {
      if (swapFirst === null) {
        setSwapFirst(idx);
      } else {
        setGrid(function(old) {
          var ng = old.slice();
          var tmp = ng[swapFirst];
          ng[swapFirst] = ng[idx];
          ng[idx] = tmp;
          return ng;
        });
        setSwapFirst(null);
      }
    } else if (tool === "erase") {
      setGrid(function(old) {
        var ng = old.slice();
        ng[idx] = null;
        return ng;
      });
    }
  }

  // Download
  function downloadGrid() {
    var tSize = sources[activeSrc] ? sources[activeSrc].tileSize : 256;
    var W = gridW * tSize;
    var H = gridH * tSize;
    if (gridW * gridH > MAX_TILES) { setDlStatus("Exceeds " + MAX_TILES + " tiles! Reduce grid."); return; }
    setDlStatus("Rendering " + W + "x" + H + "px...");
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    var total = grid.filter(function(cell) { return cell !== null; }).length;
    if (total === 0) { setDlStatus("Grid is empty!"); return; }
    var promises = [];
    for (var i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      (function(idx2, cell) {
        var gx = idx2 % gridW, gy = Math.floor(idx2 / gridW);
        var p = new Promise(function(res) {
          var img = new Image();
          img.onload = function() { ctx.drawImage(img, gx * tSize, gy * tSize, tSize, tSize); res(); };
          img.onerror = function() { res(); };
          img.src = cell.dataUrl;
        });
        promises.push(p);
      })(i, grid[i]);
    }
    Promise.all(promises).then(function() {
      c.toBlob(function(blob) {
        if (!blob) { setDlStatus("Render failed"); return; }
        var dl = document.createElement("a");
        dl.href = URL.createObjectURL(blob);
        dl.download = "tilemap_" + W + "x" + H + ".png";
        dl.click();
        setDlStatus("Downloaded " + W + "x" + H + "px!");
      }, "image/png");
    });
  }

  function clearGrid() {
    setGrid(new Array(gridW * gridH).fill(null));
    setSwapFirst(null);
  }

  // Filtered palette
  var visiblePalette = paletteFilter === -1 ? paletteTiles : paletteTiles.filter(function(t) { return t.srcIdx === paletteFilter; });
  var filledCount = grid.filter(function(c2) { return c2 !== null; }).length;

  // Toggle helper for source booleans
  function toggleSrc(field) {
    return function() {
      setSources(function(prev) {
        var n = prev.slice();
        n[activeSrc] = Object.assign({}, n[activeSrc]);
        n[activeSrc][field] = !n[activeSrc][field];
        return n;
      });
    };
  }

  return (
    <div style={S.wrap}>
      <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 4}}>
        <h1 style={S.h1}>Tile Editor</h1>
        <a href="/" style={{fontSize: "0.72rem", color: "#3b82f6", textDecoration: "none"}}>{"< Back"}</a>
      </div>
      <p style={S.sub}>{"Multi-source tile compositor (max " + MAX_TILES + " tiles)"}</p>

      {/* === SOURCES === */}
      <div style={S.card}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8}}>
          <p style={S.sec}>Sources ({sources.length}/4)</p>
          {sources.length < 4 && <button onClick={addSource} style={Object.assign({}, S.sm, {background: "#059669"})}>+ Add</button>}
        </div>

        {/* Source tabs */}
        <div style={{display: "flex", gap: 3, marginBottom: 10}}>
          {sources.map(function(src, i) {
            return <button key={i} onClick={function(){setActiveSrc(i)}}
              style={Object.assign({}, S.stab, i === activeSrc ? {background: src.color + "33", borderColor: src.color, color: "#fff"} : {})}>
              <span style={{display: "inline-block", width: 8, height: 8, borderRadius: 4, background: src.color, marginRight: 4}} />
              {src.name || "S" + (i + 1)}
            </button>;
          })}
        </div>

        {/* Active source config */}
        {sources[activeSrc] && (function() {
          var src = sources[activeSrc];
          var idx = activeSrc;
          var cols = src.maxX - src.minX + 1;
          var rows = src.maxY - src.minY + 1;
          return <>
            <input value={src.name} onChange={function(e){updateSource(idx, "name", e.target.value)}}
              placeholder="Source name" style={Object.assign({}, S.input, {marginBottom: 4})} />

            {/* Quick detect */}
            <div style={{display: "flex", gap: 4, marginBottom: 6}}>
              <input value={sampleUrl} onChange={function(e){setSampleUrl(e.target.value)}}
                placeholder="Paste a tile URL to auto-detect..." style={Object.assign({}, S.input, {flex: 1, marginBottom: 0})} />
              <button onClick={detectSource} disabled={detecting || !sampleUrl}
                style={Object.assign({}, S.sm, {background: "#7c3aed", whiteSpace: "nowrap"})}>{detecting ? "..." : "Detect"}</button>
            </div>

            <input value={src.pattern} onChange={function(e){updateSource(idx, "pattern", e.target.value)}}
              placeholder=".../{z}/{x}/{y}.webp  or  .../{z}/tile-{x}_{y}.jpg" style={S.input} />

            <div style={S.g5}>
              <div><p style={S.ml}>Zoom</p><input type="number" value={src.zoom} onChange={function(e){updateSource(idx, "zoom", +e.target.value)}} style={S.si} /></div>
              <div><p style={S.ml}>MinX</p><input type="number" value={src.minX} onChange={function(e){updateSource(idx, "minX", +e.target.value)}} style={S.si} /></div>
              <div><p style={S.ml}>MaxX</p><input type="number" value={src.maxX} onChange={function(e){updateSource(idx, "maxX", +e.target.value)}} style={S.si} /></div>
              <div><p style={S.ml}>MinY</p><input type="number" value={src.minY} onChange={function(e){updateSource(idx, "minY", +e.target.value)}} style={S.si} /></div>
              <div><p style={S.ml}>MaxY</p><input type="number" value={src.maxY} onChange={function(e){updateSource(idx, "maxY", +e.target.value)}} style={S.si} /></div>
            </div>

            {/* Swap XY / Flip X / Flip Y */}
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8}}>
              <div>
                <p style={S.ml}>Swap XY</p>
                <button onClick={toggleSrc("swapXY")}
                  style={Object.assign({}, S.si, {background: src.swapXY ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center", width: "100%"})}>
                  {src.swapXY ? "ON" : "OFF"}
                </button>
              </div>
              <div>
                <p style={S.ml}>Flip X</p>
                <button onClick={toggleSrc("flipX")}
                  style={Object.assign({}, S.si, {background: src.flipX ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center", width: "100%"})}>
                  {src.flipX ? "ON" : "OFF"}
                </button>
              </div>
              <div>
                <p style={S.ml}>Flip Y</p>
                <button onClick={toggleSrc("flipY")}
                  style={Object.assign({}, S.si, {background: src.flipY ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center", width: "100%"})}>
                  {src.flipY ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            <p style={{fontSize: "0.68rem", color: "#666", marginTop: 4}}>
              {cols + "x" + rows + " = " + (cols * rows) + " tiles | " + (cols * src.tileSize) + "x" + (rows * src.tileSize) + "px"}
            </p>

            <div style={{display: "flex", gap: 4, marginTop: 8}}>
              <button onClick={function(){loadSource(idx)}} disabled={loadingSrc || !src.pattern}
                style={Object.assign({}, S.btn, {flex: 2}, loadingSrc ? S.off : {background: src.color})}>{loadingSrc ? "Loading..." : "Load Tiles"}</button>
              <button onClick={function(){autoPlace(idx)}} style={Object.assign({}, S.btn, {flex: 1, background: "#6d28d9"})}>Auto-Place</button>
              {sources.length > 1 && <button onClick={function(){removeSource(idx)}} style={Object.assign({}, S.btn, {flex: 0, padding: "8px 12px", background: "#7f1d1d"})}>X</button>}
            </div>
          </>;
        })()}

        {loadStatus && <p style={S.st}>{loadStatus}</p>}
        {loadingSrc && loadProgress > 0 && <div style={S.bar}><div style={Object.assign({}, S.fill, {width: loadProgress + "%"})} /></div>}
      </div>

      {/* === PALETTE === */}
      {paletteTiles.length > 0 && <div style={S.card}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
          <p style={S.sec}>{"Palette (" + paletteTiles.length + " tiles)"}</p>
          <div style={{display: "flex", gap: 3}}>
            <button onClick={function(){setPaletteFilter(-1)}} style={Object.assign({}, S.sm, paletteFilter === -1 ? {background: "#555"} : {})}>All</button>
            {sources.map(function(src, i) {
              return <button key={i} onClick={function(){setPaletteFilter(i)}}
                style={Object.assign({}, S.sm, paletteFilter === i ? {background: src.color} : {})}>
                {src.name ? src.name.substring(0, 3) : "S" + (i + 1)}
              </button>;
            })}
          </div>
        </div>
        <div style={{display: "flex", gap: 3, overflowX: "auto", padding: "4px 0", WebkitOverflowScrolling: "touch"}}>
          {visiblePalette.map(function(tile) {
            var isSelected = selected && selected.key === tile.key;
            return <div key={tile.key} onClick={function(){setSelected(tile); setTool("place")}}
              style={{minWidth: 52, width: 52, height: 52, borderRadius: 4, overflow: "hidden", cursor: "pointer",
                border: isSelected ? "2px solid #fff" : "2px solid " + (sources[tile.srcIdx] ? sources[tile.srcIdx].color : "#333"),
                flexShrink: 0, position: "relative"}}>
              <img src={tile.dataUrl} style={{width: "100%", height: "100%", objectFit: "cover", display: "block"}} alt="" />
              {isSelected && <div style={{position: "absolute", inset: 0, background: "rgba(255,255,255,0.15)"}} />}
            </div>;
          })}
        </div>
        {selected && <p style={{fontSize: "0.65rem", color: "#6ee7b7", marginTop: 4}}>{"Selected: " + selected.key}</p>}
      </div>}

      {/* === TOOLBAR === */}
      <div style={S.card}>
        <div style={{display: "flex", gap: 4, marginBottom: 8}}>
          {TOOLS.map(function(t) {
            return <button key={t} onClick={function(){setTool(t); if (t !== "swap") setSwapFirst(null);}}
              style={Object.assign({}, S.btn, {flex: 1, fontSize: "0.78rem", padding: 9,
                background: tool === t ? TOOL_COLORS[t] : "#1e1e2e",
                color: tool === t ? "#fff" : "#888"})}>
              {TOOL_LABELS[t]}{t === "swap" && swapFirst !== null ? " *" : ""}
            </button>;
          })}
        </div>

        {/* Grid size */}
        <div style={{display: "flex", gap: 6, alignItems: "center", marginBottom: 6}}>
          <p style={{fontSize: "0.72rem", color: "#888", whiteSpace: "nowrap"}}>Grid:</p>
          <input type="number" value={gridW} onChange={function(e){resizeGrid(+e.target.value, gridH)}}
            style={Object.assign({}, S.si, {width: 55})} />
          <span style={{color: "#555"}}>x</span>
          <input type="number" value={gridH} onChange={function(e){resizeGrid(gridW, +e.target.value)}}
            style={Object.assign({}, S.si, {width: 55})} />
          <p style={{fontSize: "0.6rem", color: "#666"}}>{"= " + (gridW * gridH) + "/" + MAX_TILES + " tiles"}</p>
        </div>

        <div style={{display: "flex", gap: 6, alignItems: "center"}}>
          <p style={{fontSize: "0.72rem", color: "#888"}}>Zoom:</p>
          {[0.25, 0.5, 1].map(function(z) {
            return <button key={z} onClick={function(){setGridZoom(z)}}
              style={Object.assign({}, S.sm, gridZoom === z ? {background: "#3b82f6"} : {})}>{z + "x"}</button>;
          })}
          <div style={{flex: 1}} />
          <p style={{fontSize: "0.65rem", color: "#6ee7b7"}}>{filledCount + "/" + (gridW * gridH) + " filled"}</p>
        </div>
      </div>

      {/* === EDITOR GRID === */}
      <div style={Object.assign({}, S.card, {padding: 4, overflow: "auto", WebkitOverflowScrolling: "touch", maxHeight: "60vh"})}>
        <div style={{display: "grid",
          gridTemplateColumns: "repeat(" + gridW + ", " + Math.round(64 * gridZoom) + "px)",
          gap: 1, background: "#111", width: "fit-content"}}>
          {grid.map(function(cell, idx) {
            var gx = idx % gridW, gy = Math.floor(idx / gridW);
            var cellSize = Math.round(64 * gridZoom);
            var isSwapSelected = (tool === "swap" && swapFirst === idx);
            return <div key={idx} onClick={function(){onCellClick(idx)}}
              style={{width: cellSize, height: cellSize, background: cell ? "transparent" : "#0a0a0f",
                border: isSwapSelected ? "2px solid #f59e0b" : "1px solid #1a1a2a",
                cursor: "pointer", position: "relative", overflow: "hidden", boxSizing: "border-box"}}>
              {cell && <img src={cell.dataUrl} style={{width: "100%", height: "100%", objectFit: "cover", display: "block"}} alt="" />}
              {!cell && gridZoom >= 0.5 && <span style={{position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                fontSize: "0.45rem", color: "#222"}}>{gx + "," + gy}</span>}
              {cell && cell.srcIdx !== undefined && sources[cell.srcIdx] && (
                <div style={{position: "absolute", top: 0, right: 0, width: 6, height: 6, borderRadius: "0 0 0 3px",
                  background: sources[cell.srcIdx].color}} />
              )}
            </div>;
          })}
        </div>
      </div>

      {/* === ACTIONS === */}
      <div style={Object.assign({}, S.card, {display: "flex", gap: 6, flexWrap: "wrap"})}>
        <button onClick={downloadGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 120, background: "#059669"})}>Download PNG</button>
        <button onClick={clearGrid} style={Object.assign({}, S.btn, {flex: 1, minWidth: 120, background: "#7f1d1d"})}>Clear Grid</button>
      </div>
      {dlStatus && <p style={Object.assign({}, S.st, {textAlign: "center"})}>{dlStatus}</p>}

      {/* === HELP === */}
      <div style={Object.assign({}, S.card, {borderColor: "#222"})}>
        <p style={S.sec}>How it works</p>
        <p style={{fontSize: "0.72rem", color: "#999", lineHeight: 1.7}}>
          {"1. Add sources (up to 4) with different tile patterns"}<br/>
          {"2. Paste a tile URL > Detect (supports z/x/y and tile-x_y formats)"}<br/>
          {"3. Toggle Swap XY / Flip X / Flip Y if tiles appear reversed"}<br/>
          {"4. Load Tiles > Auto-Place to fill the grid"}<br/>
          {"5. Pick = grab a tile from grid to duplicate elsewhere"}<br/>
          {"6. Swap = tap two cells to exchange them"}<br/>
          {"7. Erase = clear a cell"}<br/>
          {"7. Download PNG (max " + MAX_TILES + " tiles)"}
        </p>
      </div>
    </div>
  );
}

var S = {
  wrap: { maxWidth: 600, margin: "0 auto", padding: 12, fontFamily: "-apple-system,sans-serif", background: "#0a0a0f", color: "#e0e0e8", minHeight: "100vh" },
  h1: { fontSize: "1.2rem", fontWeight: 700, color: "#6ee7b7", marginBottom: 0 },
  sub: { fontSize: "0.72rem", color: "#777", marginBottom: 12 },
  card: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 10 },
  sec: { fontSize: "0.82rem", fontWeight: 600, color: "#fbbf24", marginBottom: 4 },
  input: { width: "100%", padding: 9, background: "#0d0d14", border: "1px solid #333", borderRadius: 7, color: "#eee", fontSize: "0.78rem", marginBottom: 6, boxSizing: "border-box" },
  si: { padding: 7, background: "#0d0d14", border: "1px solid #333", borderRadius: 6, color: "#eee", fontSize: "0.75rem", boxSizing: "border-box" },
  btn: { display: "block", padding: 10, border: "none", borderRadius: 7, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", color: "#fff", textAlign: "center" },
  sm: { padding: "4px 8px", border: "none", borderRadius: 5, fontSize: "0.68rem", fontWeight: 600, cursor: "pointer", color: "#ddd", background: "#2a2a3a" },
  off: { background: "#555", cursor: "not-allowed" },
  st: { fontSize: "0.72rem", color: "#fbbf24", marginTop: 6 },
  ml: { fontSize: "0.62rem", color: "#888", marginBottom: 2 },
  g5: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 5, marginTop: 6 },
  bar: { width: "100%", height: 5, background: "#1e1e2e", borderRadius: 3, marginTop: 6, overflow: "hidden" },
  fill: { height: "100%", background: "#3b82f6", borderRadius: 3, transition: "width 0.3s" },
  stab: { flex: 1, padding: "6px 4px", border: "1px solid #333", borderRadius: 6, background: "#1e1e2e", color: "#888", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" },
};
