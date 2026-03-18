import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const maxDuration = 60; // Vercel max timeout

export default async function handler(req, res) {
  const { url, maxZoom } = req.query;
  const targetUrl = url || "https://wuthering.th.gl/maps/Overworld";
  const targetZoom = parseInt(maxZoom) || 5;

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Intercept ALL network requests and collect image URLs
    const tileUrls = new Set();
    const allImageUrls = new Set();
    const tilePatterns = new Set();

    await page.setRequestInterception(true);

    page.on("request", (request) => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();

      // Collect image requests
      if (resourceType === "image" || reqUrl.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)) {
        allImageUrls.add(reqUrl);

        // Detect tile-like URLs (contain z/x/y numeric patterns)
        if (reqUrl.match(/\/\d{1,2}\/\d{1,5}\/\d{1,5}\.(png|jpg|jpeg|webp)/i)) {
          tileUrls.add(reqUrl);
          // Derive pattern
          const m = reqUrl.match(/^(.*?)(\d{1,2})\/(\d{1,5})\/(\d{1,5})(\.\w{3,5})(.*)$/);
          if (m) {
            tilePatterns.add(m[1] + "{z}/{x}/{y}" + m[5] + m[6]);
          }
        }

        // Also detect tile URLs with different separators
        if (reqUrl.match(/\/\d{1,2}[/_-]\d{1,5}[/_-]\d{1,5}/)) {
          tileUrls.add(reqUrl);
        }
      }

      // Block heavy non-essential resources to speed up
      if (["font", "stylesheet", "media"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to the map page
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for map to render
    await new Promise(r => setTimeout(r, 3000));

    // Try to find and interact with the Leaflet map
    // First, try to extract tile layer URL directly from Leaflet
    const leafletInfo = await page.evaluate(() => {
      const result = { tileUrls: [], patterns: [], mapInfo: null, allImgSrcs: [] };

      // Collect all img src on page
      document.querySelectorAll("img").forEach((img) => {
        if (img.src && (img.naturalWidth === 256 || img.width === 256)) {
          result.allImgSrcs.push(img.src);
        }
      });

      // Collect all canvas elements info
      const canvases = document.querySelectorAll("canvas");
      result.canvasCount = canvases.length;

      // Try to find Leaflet map instance
      for (const key of Object.keys(window)) {
        try {
          const obj = window[key];
          if (obj && typeof obj.getZoom === "function" && typeof obj.eachLayer === "function") {
            result.mapInfo = {
              zoom: obj.getZoom(),
              maxZoom: obj.getMaxZoom(),
              minZoom: obj.getMinZoom(),
              center: [obj.getCenter().lat, obj.getCenter().lng],
              bounds: obj.getBounds ? {
                ne: [obj.getBounds().getNorthEast().lat, obj.getBounds().getNorthEast().lng],
                sw: [obj.getBounds().getSouthWest().lat, obj.getBounds().getSouthWest().lng],
              } : null,
            };

            obj.eachLayer((layer) => {
              if (layer._url) result.patterns.push(layer._url);
              if (layer.getTileUrl) {
                try {
                  // Try to get a sample tile URL
                  const sampleUrl = layer.getTileUrl({ x: 0, y: 0, z: 2 });
                  if (sampleUrl) result.tileUrls.push(sampleUrl);
                } catch (e) {}
              }
              if (layer._tiles) {
                Object.values(layer._tiles).forEach((tile) => {
                  if (tile.el && tile.el.src) result.tileUrls.push(tile.el.src);
                  if (tile.el && tile.el.currentSrc) result.tileUrls.push(tile.el.currentSrc);
                });
              }
            });
            break;
          }
        } catch (e) {}
      }

      return result;
    });

    // Add Leaflet findings to our sets
    leafletInfo.tileUrls.forEach((u) => tileUrls.add(u));
    leafletInfo.patterns.forEach((p) => tilePatterns.add(p));
    leafletInfo.allImgSrcs.forEach((u) => allImageUrls.add(u));

    // Now zoom in to load higher-res tiles
    for (let z = 1; z <= Math.min(targetZoom, 7); z++) {
      await page.evaluate((zoomLevel) => {
        for (const key of Object.keys(window)) {
          try {
            const obj = window[key];
            if (obj && typeof obj.setZoom === "function" && typeof obj.getZoom === "function") {
              obj.setZoom(zoomLevel);
              break;
            }
          } catch (e) {}
        }
      }, z);

      // Wait for tiles to load at this zoom level
      await new Promise(r => setTimeout(r, 2000));

      // Collect tiles loaded at this zoom
      const zoomTiles = await page.evaluate(() => {
        const tiles = [];
        document.querySelectorAll("img").forEach((img) => {
          if (img.src && (img.naturalWidth === 256 || img.width === 256 || img.src.match(/\/\d+\/\d+\/\d+/))) {
            tiles.push(img.src);
          }
        });
        // Also check for tiles in Leaflet layers
        for (const key of Object.keys(window)) {
          try {
            const obj = window[key];
            if (obj && typeof obj.eachLayer === "function") {
              obj.eachLayer((layer) => {
                if (layer._tiles) {
                  Object.values(layer._tiles).forEach((tile) => {
                    if (tile.el && tile.el.src) tiles.push(tile.el.src);
                  });
                }
              });
              break;
            }
          } catch (e) {}
        }
        return tiles;
      });

      zoomTiles.forEach((u) => {
        tileUrls.add(u);
        const m = u.match(/^(.*?)(\d{1,2})\/(\d{1,5})\/(\d{1,5})(\.\w{3,5})(.*)$/);
        if (m) tilePatterns.add(m[1] + "{z}/{x}/{y}" + m[5] + m[6]);
      });
    }

    await browser.close();
    browser = null;

    // Build response
    const tilesArr = [...tileUrls].filter(u => u.startsWith("http"));
    const patternsArr = [...tilePatterns];
    const imagesArr = [...allImageUrls].filter(u => u.startsWith("http"));

    // Analyze tiles to find zoom range and bounds
    let analysis = { zooms: {}, maxZoomFound: 0 };
    tilesArr.forEach((u) => {
      const m = u.match(/\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.\w+/);
      if (m) {
        const z = parseInt(m[1]);
        if (!analysis.zooms[z]) analysis.zooms[z] = { minX: Infinity, maxX: -1, minY: Infinity, maxY: -1, count: 0 };
        const x = parseInt(m[2]), y = parseInt(m[3]);
        analysis.zooms[z].minX = Math.min(analysis.zooms[z].minX, x);
        analysis.zooms[z].maxX = Math.max(analysis.zooms[z].maxX, x);
        analysis.zooms[z].minY = Math.min(analysis.zooms[z].minY, y);
        analysis.zooms[z].maxY = Math.max(analysis.zooms[z].maxY, y);
        analysis.zooms[z].count++;
        analysis.maxZoomFound = Math.max(analysis.maxZoomFound, z);
      }
    });

    res.json({
      success: true,
      patterns: patternsArr,
      tiles: tilesArr.slice(0, 100),
      totalTiles: tilesArr.length,
      allImages: imagesArr.slice(0, 50),
      leafletInfo: {
        mapInfo: leafletInfo.mapInfo,
        canvasCount: leafletInfo.canvasCount,
      },
      analysis,
      url: targetUrl,
    });

  } catch (e) {
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: e.message, stack: e.stack?.split("\n").slice(0, 3) });
  }
}
