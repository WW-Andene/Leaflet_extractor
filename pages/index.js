import { useState, useRef } from "react";
import EditorTab from "../components/EditorTab";

var PRESETS = [
  { label: "Overworld", url: "https://wuthering.gg/map" },
  { label: "Rinascita", url: "https://wuthering.gg/map/rinascita" },
  { label: "Tethys Deep", url: "https://wuthering.gg/map/tethys-deep" },
  { label: "Lahai-Roi", url: "https://wuthering.gg/map/lahai-roi" },
  { label: "Frostlands", url: "https://wuthering.gg/map/roya-frostlands" },
  { label: "Appsample", url: "https://wuthering-waves-map.appsample.com/" },
  { label: "TH.GL", url: "https://wuthering.th.gl/maps/Overworld" },
];

export default function Home() {
  var s = useState, a;
  a = s(""); var url = a[0], setUrl = a[1];
  a = s(false); var loading = a[0], setLoading = a[1];
  a = s(""); var status = a[0], setStatus = a[1];
  a = s(null); var results = a[0], setResults = a[1];
  a = s(false); var copied = a[0], setCopied = a[1];
  a = s("extract"); var tab = a[0], setTab = a[1];
  a = s(""); var sampleTileUrl = a[0], setSampleTileUrl = a[1];
  a = s(""); var tilePattern = a[0], setTilePattern = a[1];
  a = s(3); var zoom = a[0], setZoom = a[1];
  a = s(0); var minX = a[0], setMinX = a[1];
  a = s(7); var maxX = a[0], setMaxX = a[1];
  a = s(0); var minY = a[0], setMinY = a[1];
  a = s(7); var maxY = a[0], setMaxY = a[1];
  a = s(256); var tileSize = a[0], setTileSize = a[1];
  a = s(""); var stitchStatus = a[0], setStitchStatus = a[1];
  a = s(0); var stitchProgress = a[0], setStitchProgress = a[1];
  a = s(false); var stitching = a[0], setStitching = a[1];
  a = s(null); var previewUrl = a[0], setPreviewUrl = a[1];
  a = s(true); var useProxy = a[0], setUseProxy = a[1];
  a = s(false); var flipY = a[0], setFlipY = a[1];
  a = s(false); var flipX = a[0], setFlipX = a[1];
  a = s("zxy"); var coordOrder = a[0], setCoordOrder = a[1];
  a = s(null); var gridPreview = a[0], setGridPreview = a[1];
  a = s(null); var probeImg = a[0], setProbeImg = a[1];
  a = s([]); var failedTiles = a[0], setFailedTiles = a[1];
  a = s(null); var canvasCtx = a[0], setCanvasCtx = a[1];
  a = s(null); var canvasEl = a[0], setCanvasEl = a[1];
  a = s(null); var probeResults = a[0], setProbeResults = a[1];
  a = s(false); var probing = a[0], setProbing = a[1];

  var stitchAbortRef = useRef(false);

  // --- EXTRACT ---
  async function extract() {
    if (!url) return;
    setLoading(true); setResults(null);
    setStatus("Fetching and scanning JS bundles...");
    try {
      var r = await fetch("/api/extract?url=" + encodeURIComponent(url));
      var d = await r.json();
      if (d.error) setStatus("Error: " + d.error);
      else {
        setStatus("Found " + d.patterns.length + " pattern(s), " + d.tiles.length + " tile(s)");
        setResults(d);
        if (d.patterns.length > 0) setTilePattern(d.patterns[0]);
      }
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  }

  // --- DETECT FROM SAMPLE TILE ---
  async function detectFromSample() {
    if (!sampleTileUrl) return;
    setProbing(true); setProbeImg(null); setProbeResults(null);
    setStitchStatus("Analyzing tile URL and finding bounds...");
    try {
      var r = await fetch("/api/probe?sampleTile=" + encodeURIComponent(sampleTileUrl));
      var d = await r.json();
      setProbeResults(d);
      if (d.success) {
        setTilePattern(d.pattern);
        setZoom(d.detectedZoom);
        setMinX(d.bounds.minX); setMinY(d.bounds.minY);
        setMaxX(d.bounds.maxX); setMaxY(d.bounds.maxY);
        var cols = d.bounds.maxX - d.bounds.minX + 1;
        var rows = d.bounds.maxY - d.bounds.minY + 1;
        setStitchStatus("Pattern: " + d.pattern + " | Zoom " + d.detectedZoom + " | " + cols + "x" + rows + " tiles");
        var testUrl = d.pattern.replace("{z}", d.detectedZoom).replace("{x}", d.detectedX).replace("{y}", d.detectedY);
        setProbeImg("/api/tile-proxy?url=" + encodeURIComponent(testUrl));
      } else {
        setStitchStatus("Could not detect pattern: " + (d.error || "unknown"));
      }
    } catch (e) { setStitchStatus("Error: " + e.message); }
    setProbing(false);
  }

  // --- COORD ORDER ---
  var COORD_ORDERS = ["zxy", "zyx", "xzy", "xyz", "yzx", "yxz"];
  function nextOrder() {
    var i = COORD_ORDERS.indexOf(coordOrder);
    setCoordOrder(COORD_ORDERS[(i + 1) % COORD_ORDERS.length]);
  }

  // --- HELPERS ---
  function buildUrl(pat, z, x, y) {
    var vals = { z: z, x: x, y: y };
    return pat.replace("{z}", vals[coordOrder[0]]).replace("{x}", vals[coordOrder[1]]).replace("{y}", vals[coordOrder[2]]);
  }
  function loadImg(src) {
    return new Promise(function(res) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function() { res(img); };
      img.onerror = function() { res(null); };
      img.src = src;
    });
  }
  function proxied(u) {
    return useProxy ? "/api/tile-proxy?url=" + encodeURIComponent(u) : u;
  }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // --- GRID PREVIEW ---
  async function showGridPreview() {
    var cx = Math.round((minX + maxX) / 2);
    var cy = Math.round((minY + maxY) / 2);
    setStitchStatus("Loading 4x4 preview with size checks...");
    var tiles = [];
    for (var dy = -1; dy <= 2; dy++) {
      for (var dx = -1; dx <= 2; dx++) {
        var x = cx + dx, y = cy + dy;
        var rawUrl = buildUrl(tilePattern, zoom, x, y);
        tiles.push({ x: x, y: y, rawUrl: rawUrl, url: proxied(rawUrl), label: "x=" + x + " y=" + y });
      }
    }
    // Check sizes in parallel
    var checks = await Promise.all(tiles.map(function(t) {
      return fetch("/api/tile-proxy?check=1&url=" + encodeURIComponent(t.rawUrl))
        .then(function(r) { return r.json(); })
        .catch(function() { return { ok: false, size: 0 }; });
    }));
    var grid = [];
    for (var i = 0; i < 4; i++) {
      var row = [];
      for (var j = 0; j < 4; j++) {
        var idx = i * 4 + j;
        var t = tiles[idx];
        var c = checks[idx];
        t.size = c.size || 0;
        t.exists = c.ok && c.size > 2000;
        row.push(t);
      }
      grid.push(row);
    }
    setGridPreview(grid);
    var loaded = grid.flat().filter(function(t) { return t.exists; }).length;
    setStitchStatus("4x4: " + loaded + "/16 tiles have content. Small/empty tiles marked red.");
  }

  // --- TEST ONE TILE ---
  async function testOneTile() {
    setProbeImg(null);
    var u = proxied(buildUrl(tilePattern, zoom, minX, minY));
    setStitchStatus("Testing z=" + zoom + " x=" + minX + " y=" + minY + "...");
    var img = await loadImg(u);
    if (img) { setProbeImg(u); setStitchStatus("Tile OK! " + img.naturalWidth + "x" + img.naturalHeight + "px"); }
    else setStitchStatus("Failed. Check pattern/bounds.");
  }

  // --- DOWNLOAD TILES ---
  async function downloadTiles(tiles, ctx, total, slow) {
    var done = 0;
    var failed = [];
    var batchSize = slow ? 1 : 2;
    var delayMs = slow ? 800 : 300;
    var maxRetries = slow ? 5 : 3;

    for (var i = 0; i < tiles.length; i += batchSize) {
      if (stitchAbortRef.current) {
        setStitchStatus("Stopped! " + done + " loaded, " + failed.length + " failed, rest skipped");
        return { done: done, failed: failed };
      }
      var b = tiles.slice(i, i + batchSize);
      var promises = b.map(function(tile) {
        return (async function(x, y) {
          var u = proxied(buildUrl(tilePattern, zoom, x, y));
          var img = null;
          for (var attempt = 0; attempt < maxRetries; attempt++) {
            img = await loadImg(u);
            if (img) break;
            await wait(600 * (attempt + 1));
          }
          if (img) {
            var px = (flipX ? (maxX - x) : (x - minX)) * tileSize;
            var py = (flipY ? (maxY - y) : (y - minY)) * tileSize;
            ctx.drawImage(img, px, py, tileSize, tileSize);
            done++;
          } else {
            failed.push({ x: x, y: y });
          }
        })(tile.x, tile.y);
      });
      await Promise.all(promises);
      await wait(delayMs);
      setStitchProgress(Math.round(((i + b.length) / tiles.length) * 100));
      setStitchStatus((slow ? "Retry: " : "") + (done + failed.length) + "/" + total + " (" + failed.length + " failed)");
    }
    return { done: done, failed: failed };
  }

  // --- STITCH ---
  async function stitch() {
    if (!tilePattern || stitching) return;
    stitchAbortRef.current = false;
    setStitching(true); setPreviewUrl(null); setStitchProgress(0); setFailedTiles([]);
    var cols = maxX - minX + 1, rows = maxY - minY + 1;
    var total = cols * rows, W = cols * tileSize, H = rows * tileSize;
    setStitchStatus("Stitching " + W + "x" + H + "px (" + total + " tiles)...");
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#0a0a0f"; ctx.fillRect(0, 0, W, H);
    setCanvasCtx(ctx); setCanvasEl(c);
    var all = [];
    for (var y = minY; y <= maxY; y++)
      for (var x = minX; x <= maxX; x++) all.push({ x: x, y: y });
    var result = await downloadTiles(all, ctx, total, false);
    setFailedTiles(result.failed);
    setStitchStatus("Done! " + result.done + "/" + total + (result.failed.length > 0 ? " - " + result.failed.length + " failed" : " All loaded!"));
    c.toBlob(function(blob) { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  // --- RETRY FAILED ---
  async function retryFailed() {
    if (!canvasCtx || !canvasEl || failedTiles.length === 0 || stitching) return;
    setStitching(true); setStitchProgress(0);
    setStitchStatus("Retrying " + failedTiles.length + " failed tiles (1 at a time)...");
    var result = await downloadTiles(failedTiles, canvasCtx, failedTiles.length, true);
    setFailedTiles(result.failed);
    setStitchStatus("Retry done! " + result.done + " recovered." + (result.failed.length > 0 ? " " + result.failed.length + " still failing" : " All tiles loaded!"));
    canvasEl.toBlob(function(blob) { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  // --- FETCH MISSING (scan canvas for black tiles) ---
  async function fetchMissing() {
    if (!canvasCtx || !canvasEl || stitching) return;
    setStitching(true); setStitchProgress(0);
    var missing = [];
    var bgColor = [10, 10, 15]; // #0a0a0f
    var threshold = 30;

    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var px = (flipX ? (maxX - x) : (x - minX)) * tileSize;
        var py = (flipY ? (maxY - y) : (y - minY)) * tileSize;
        // Sample a few pixels from this tile area
        var data = canvasCtx.getImageData(px + tileSize / 2, py + tileSize / 2, 1, 1).data;
        var data2 = canvasCtx.getImageData(px + 10, py + 10, 1, 1).data;
        var data3 = canvasCtx.getImageData(px + tileSize - 10, py + tileSize - 10, 1, 1).data;
        // Check if all samples are close to bg color
        var isBlack = function(d) {
          return Math.abs(d[0] - bgColor[0]) < threshold &&
                 Math.abs(d[1] - bgColor[1]) < threshold &&
                 Math.abs(d[2] - bgColor[2]) < threshold;
        };
        if (isBlack(data) && isBlack(data2) && isBlack(data3)) {
          missing.push({ x: x, y: y });
        }
      }
    }

    if (missing.length === 0) {
      setStitchStatus("No missing tiles detected! Canvas looks complete.");
      setStitching(false);
      return;
    }

    setStitchStatus("Found " + missing.length + " missing tiles. Downloading 1 at a time...");
    var result = await downloadTiles(missing, canvasCtx, missing.length, true);
    setFailedTiles(result.failed);
    setStitchStatus("Fetch missing done! " + result.done + " filled." + (result.failed.length > 0 ? " " + result.failed.length + " still missing" : " All complete!"));
    canvasEl.toBlob(function(blob) { if (blob) setPreviewUrl(URL.createObjectURL(blob)); }, "image/png");
    setStitching(false);
  }

  function stopStitch() { stitchAbortRef.current = true; }

  // --- RENDER ---
  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Leaflet Tile Extractor</h1>
      <p style={S.sub}>Extract tile URLs and stitch full maps</p>

      <div style={S.tabs}>
        <button style={Object.assign({}, S.tab, tab === "extract" ? S.tabOn : {})} onClick={function(){setTab("extract")}}>Extract</button>
        <button style={Object.assign({}, S.tab, tab === "stitch" ? S.tabOn : {})} onClick={function(){setTab("stitch")}}>Stitch</button>
        <button style={Object.assign({}, S.tab, tab === "editor" ? {background: "#2d1b4e", color: "#a78bfa", borderColor: "#7c3aed"} : {background: "#1e1e2e", borderColor: "#7c3aed", color: "#a78bfa"})} onClick={function(){setTab("editor")}}>Editor</button>
      </div>

      {tab === "extract" && <>
        <div style={S.card}>
          <div style={S.chips}>{PRESETS.map(function(p) { return (
            <button key={p.url} onClick={function(){setUrl(p.url)}} style={Object.assign({}, S.chip, url === p.url ? S.chipOn : {})}>{p.label}</button>
          );})}</div>
          <input value={url} onChange={function(e){setUrl(e.target.value)}} placeholder="Map URL..." style={S.input} />
          <button onClick={extract} disabled={loading || !url} style={Object.assign({}, S.btn, loading ? S.off : S.blue)}>{loading ? "Scanning..." : "Extract"}</button>
          {status && <p style={S.st}>{status}</p>}
        </div>
        {results && (results.patterns.length > 0 || results.tiles.length > 0) && <div style={S.card}>
          {results.patterns.length > 0 && <>
            <p style={S.sec}>{"Patterns (" + results.patterns.length + "):"}</p>
            {results.patterns.map(function(p, i) { return <div key={i} style={S.mono}>{p}</div>; })}
          </>}
          {results.tiles.length > 0 && <>
            <p style={Object.assign({}, S.sec, {marginTop: 12})}>{"Tiles (" + results.tiles.length + "):"}</p>
            <div style={Object.assign({}, S.mono, {maxHeight: 160, overflowY: "auto"})}>{results.tiles.map(function(t, i) { return <div key={i}>{t}</div>; })}</div>
          </>}
          <div style={{display: "flex", gap: 8, marginTop: 10}}>
            <button onClick={function() {
              var t = (results.patterns || []).join("\n") + "\n" + (results.tiles || []).join("\n");
              navigator.clipboard.writeText(t).catch(function(){});
              setCopied(true); setTimeout(function(){setCopied(false)}, 2000);
            }} style={Object.assign({}, S.btn, {flex: 1, background: "#059669", color: "#fff"})}>{copied ? "Copied!" : "Copy"}</button>
            <button onClick={function() { if (results.patterns[0]) setTilePattern(results.patterns[0]); setTab("stitch"); }}
              style={Object.assign({}, S.btn, {flex: 1, background: "#7c3aed", color: "#fff"})}>{"Stitch \u2192"}</button>
          </div>
        </div>}
      </>}

      {tab === "stitch" && <>
        <div style={Object.assign({}, S.card, {borderColor: "#7c3aed"})}>
          <p style={Object.assign({}, S.sec, {color: "#a78bfa"})}>Paste One Tile URL</p>
          <p style={{fontSize: "0.72rem", color: "#888", marginBottom: 8}}>
            Use extract.pics on a map site. Find any 256x256 tile. Copy its URL. Paste here.
          </p>
          <input value={sampleTileUrl} onChange={function(e){setSampleTileUrl(e.target.value)}}
            placeholder="https://cdn.example.com/tiles/3/4/5.png" style={S.input} />
          <button onClick={detectFromSample} disabled={probing || !sampleTileUrl}
            style={Object.assign({}, S.btn, probing ? S.off : {background: "#7c3aed", color: "#fff"})}>
            {probing ? "Detecting..." : "Auto-Detect Pattern and Bounds"}
          </button>
          {probeResults && probeResults.success && probeResults.bounds && probeResults.bounds.zoomInfo && <>
            <p style={Object.assign({}, S.sec, {marginTop: 12})}>Available zoom levels:</p>
            <div style={S.mono}>
              {Object.entries(probeResults.bounds.zoomInfo).map(function(entry) {
                var z = entry[0], info = entry[1];
                return <div key={z} style={{cursor: "pointer"}} onClick={function() {
                  setZoom(parseInt(z));
                  setMinX(info.estimatedMinX || 0); setMaxX(info.estimatedMaxX);
                  setMinY(info.estimatedMinY || 0); setMaxY(info.estimatedMaxY);
                }}>
                  {"z=" + z + ": [" + (info.estimatedMinX||0) + "-" + info.estimatedMaxX + "] x [" + (info.estimatedMinY||0) + "-" + info.estimatedMaxY + "] ~" + (info.estimatedTiles||"?") + " tiles" + (parseInt(z) === zoom ? " \u2190 selected" : " (tap)")}
                </div>;
              })}
            </div>
          </>}
        </div>

        <div style={S.card}>
          <p style={S.sec}>Tile Settings</p>
          <input value={tilePattern} onChange={function(e){setTilePattern(e.target.value)}}
            placeholder="https://.../{z}/{x}/{y}.png or tile-{x}_{y}.jpg" style={S.input} />
          <div style={S.g3}>
            <div><p style={S.ml}>Zoom</p><input type="number" value={zoom} onChange={function(e){setZoom(+e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>Tile px</p><input type="number" value={tileSize} onChange={function(e){setTileSize(+e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>Proxy</p><button onClick={function(){setUseProxy(!useProxy)}} style={Object.assign({}, S.si, {background: useProxy ? "#059669" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"})}>{useProxy ? "ON" : "OFF"}</button></div>
          </div>
          <div style={S.g3}>
            <div><p style={S.ml}>Flip Y</p><button onClick={function(){setFlipY(!flipY)}} style={Object.assign({}, S.si, {background: flipY ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"})}>{flipY ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Flip X</p><button onClick={function(){setFlipX(!flipX)}} style={Object.assign({}, S.si, {background: flipX ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"})}>{flipX ? "ON" : "OFF"}</button></div>
            <div><p style={S.ml}>Order</p><button onClick={nextOrder} style={Object.assign({}, S.si, {background: coordOrder !== "zxy" ? "#d97706" : "#333", color: "#fff", border: "none", cursor: "pointer", textAlign: "center"})}>{coordOrder.toUpperCase()}</button></div>
          </div>
          <div style={S.g4}>
            <div><p style={S.ml}>Min X</p><input type="number" value={minX} onChange={function(e){setMinX(+e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>Max X</p><input type="number" value={maxX} onChange={function(e){setMaxX(+e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>Min Y</p><input type="number" value={minY} onChange={function(e){setMinY(+e.target.value)}} style={S.si} /></div>
            <div><p style={S.ml}>Max Y</p><input type="number" value={maxY} onChange={function(e){setMaxY(+e.target.value)}} style={S.si} /></div>
          </div>
          <p style={{fontSize: "0.72rem", color: "#666", marginTop: 6}}>
            {"Output: " + (maxX - minX + 1) * tileSize + "x" + (maxY - minY + 1) * tileSize + "px (" + (maxX - minX + 1) * (maxY - minY + 1) + " tiles)"}
          </p>
          <div style={{display: "flex", gap: 6, marginTop: 10}}>
            <button onClick={testOneTile} disabled={!tilePattern} style={Object.assign({}, S.btn, {flex: 1, background: "#d97706", color: "#fff"})}>Test 1</button>
            <button onClick={showGridPreview} disabled={!tilePattern} style={Object.assign({}, S.btn, {flex: 1, background: "#6d28d9", color: "#fff"})}>4x4</button>
            {!stitching && <button onClick={stitch} disabled={!tilePattern} style={Object.assign({}, S.btn, {flex: 1}, S.blue)}>Stitch</button>}
            {stitching && <button onClick={stopStitch} style={Object.assign({}, S.btn, {flex: 1, background: "#dc2626", color: "#fff"})}>Stop</button>}
          </div>
          {stitchStatus && <p style={S.st}>{stitchStatus}</p>}
          {stitching && stitchProgress > 0 && <div style={S.bar}><div style={Object.assign({}, S.fill, {width: stitchProgress + "%"})} /></div>}
        </div>

        {probeImg && <div style={S.card}>
          <p style={S.sec}>Tile Preview:</p>
          <img src={probeImg} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="probe" />
        </div>}

        {gridPreview && <div style={S.card}>
          <p style={S.sec}>4x4 Grid Preview (center of map):</p>
          <p style={{fontSize: "0.7rem", color: "#888", marginBottom: 8}}>
            If tiles are scrambled, try cycling Order (ZXY/ZYX/...) or Flip options, then tap 4x4 again.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2, background: "#000", borderRadius: 6, overflow: "hidden"}}>
            {gridPreview.flat().map(function(tile, i) { return (
              <div key={i} style={{position: "relative", background: "#0a0a0f", border: tile.exists ? "2px solid #059669" : "2px solid #dc2626"}}>
                {tile.exists && <img src={tile.url} style={{width: "100%", display: "block"}} alt={tile.label}
                  onError={function(e){e.target.style.opacity = 0.1}} />}
                {!tile.exists && <div style={{width: "100%", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", fontSize: "1.2rem", fontWeight: 700}}>X</div>}
                <div style={{position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", color: tile.exists ? "#6ee7b7" : "#f87171", fontSize: "0.42rem", padding: "2px 3px", textAlign: "center"}}>
                  {tile.label + " " + (tile.size > 0 ? Math.round(tile.size / 1024) + "KB" : "0")}
                </div>
              </div>
            );})}
          </div>
        </div>}

        {previewUrl && <div style={S.card}>
          <p style={S.sec}>Stitched Map:</p>
          <img src={previewUrl} style={{maxWidth: "100%", borderRadius: 6, border: "1px solid #333"}} alt="map" />
          <div style={{display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap"}}>
            {failedTiles.length > 0 && (
              <button onClick={retryFailed} disabled={stitching}
                style={Object.assign({}, S.btn, {flex: 1, minWidth: 120}, stitching ? S.off : {background: "#d97706", color: "#fff"})}>
                {stitching ? "Retrying..." : "Retry " + failedTiles.length + " Failed"}
              </button>
            )}
            <button onClick={fetchMissing} disabled={stitching}
              style={Object.assign({}, S.btn, {flex: 1, minWidth: 120}, stitching ? S.off : {background: "#6d28d9", color: "#fff"})}>
              {stitching ? "Scanning..." : "Fetch Missing"}
            </button>
            <button onClick={function() { var a = document.createElement("a"); a.href = previewUrl; a.download = "wuwa_map_z" + zoom + ".png"; a.click(); }}
              style={Object.assign({}, S.btn, {flex: 1, minWidth: 120, background: "#059669", color: "#fff"})}>Download PNG</button>
          </div>
        </div>}

        <div style={Object.assign({}, S.card, {borderColor: "#333"})}>
          <p style={S.sec}>How to use</p>
          <p style={{fontSize: "0.75rem", color: "#999", lineHeight: 1.7}}>
            {"1. Open extract.pics in browser"}<br/>
            {"2. Paste map URL (e.g. wuthering-waves-map.appsample.com)"}<br/>
            {"3. Extract > find 256x256 tile > copy URL"}<br/>
            {"4. Paste above > Auto-Detect"}<br/>
            {"5. Pick zoom level > Stitch > Download"}<br/>
            {"6. If black tiles remain: tap Fetch Missing or Retry"}
          </p>
        </div>
      </>}

      {/* Editor tab - stays mounted so state persists */}
      <div style={{display: tab === "editor" ? "block" : "none"}}>
        <EditorTab />
      </div>
    </div>
  );
}

var S = {
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
