import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const maxDuration = 60;

// Fix for missing shared libraries on Vercel
chromium.setGraphicsMode = false;

export default async function handler(req, res) {
  const { url, maxZoom } = req.query;
  const targetUrl = url || "https://wuthering.th.gl/maps/Overworld";
  const targetZoom = parseInt(maxZoom) || 4;

  let browser = null;

  try {
    const execPath = await chromium.executablePath();

    // Set LD_LIBRARY_PATH to chromium's directory so it finds libnss3 etc
    const chromiumDir = execPath.substring(0, execPath.lastIndexOf("/"));
    process.env.LD_LIBRARY_PATH = chromiumDir + ":" + (process.env.LD_LIBRARY_PATH || "");

    browser = await puppeteer.launch({
      args: puppeteer.defaultArgs({
        args: chromium.args,
        headless: "shell",
      }),
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: execPath,
      headless: "shell",
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    const tileUrls = new Set();
    const allImageUrls = new Set();
    const tilePatterns = new Set();

    await page.setRequestInterception(true);

    page.on("request", (request) => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();

      if (resourceType === "image" || reqUrl.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)) {
        allImageUrls.add(reqUrl);
        if (reqUrl.match(/\/\d{1,2}\/\d{1,5}\/\d{1,5}\.(png|jpg|jpeg|webp)/i)) {
          tileUrls.add(reqUrl);
          const m = reqUrl.match(/^(.*?)(\d{1,2})\/(\d{1,5})\/(\d{1,5})(\.\w{3,5})(.*)$/);
          if (m) tilePatterns.add(m[1] + "{z}/{x}/{y}" + m[5] + m[6]);
        }
        if (reqUrl.match(/\/\d{1,2}[/_-]\d{1,5}[/_-]\d{1,5}/)) {
          tileUrls.add(reqUrl);
        }
      }

      if (["font", "stylesheet", "media"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 3000));

    const leafletInfo = await page.evaluate(() => {
      const result = { tileUrls: [], patterns: [], mapInfo: null, canvasCount: 0 };
      result.canvasCount = document.querySelectorAll("canvas").length;
      document.querySelectorAll("img").forEach((img) => {
        if (img.src && (img.naturalWidth === 256 || img.width === 256)) result.tileUrls.push(img.src);
      });
      for (const key of Object.keys(window)) {
        try {
          const obj = window[key];
          if (obj && typeof obj.getZoom === "function" && typeof obj.eachLayer === "function") {
            result.mapInfo = {
              zoom: obj.getZoom(), maxZoom: obj.getMaxZoom(),
              minZoom: obj.getMinZoom(),
              center: [obj.getCenter().lat, obj.getCenter().lng],
            };
            obj.eachLayer((layer) => {
              if (layer._url) result.patterns.push(layer._url);
              if (layer._tiles) {
                Object.values(layer._tiles).forEach((tile) => {
                  if (tile.el && tile.el.src) result.tileUrls.push(tile.el.src);
                });
              }
            });
            break;
          }
        } catch (e) {}
      }
      return result;
    });

    leafletInfo.tileUrls.forEach((u) => tileUrls.add(u));
    leafletInfo.patterns.forEach((p) => tilePatterns.add(p));

    for (let z = 1; z <= Math.min(targetZoom, 7); z++) {
      await page.evaluate((zl) => {
        for (const key of Object.keys(window)) {
          try {
            const obj = window[key];
            if (obj && typeof obj.setZoom === "function" && typeof obj.getZoom === "function") {
              obj.setZoom(zl); break;
            }
          } catch (e) {}
        }
      }, z);
      await new Promise((r) => setTimeout(r, 2000));

      const zoomTiles = await page.evaluate(() => {
        const tiles = [];
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
        document.querySelectorAll("img").forEach((img) => {
          if (img.src && (img.naturalWidth === 256 || img.width === 256)) tiles.push(img.src);
        });
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

    const tilesArr = [...tileUrls].filter((u) => u.startsWith("http"));
    const patternsArr = [...tilePatterns];

    let analysis = { zooms: {}, maxZoomFound: 0 };
    tilesArr.forEach((u) => {
      const m = u.match(/\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.\w+/);
      if (m) {
        const z = parseInt(m[1]), x = parseInt(m[2]), y = parseInt(m[3]);
        if (!analysis.zooms[z]) analysis.zooms[z] = { minX: Infinity, maxX: -1, minY: Infinity, maxY: -1, count: 0 };
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
      allImages: [...allImageUrls].slice(0, 50),
      leafletInfo: { mapInfo: leafletInfo.mapInfo, canvasCount: leafletInfo.canvasCount },
      analysis,
      url: targetUrl,
    });
  } catch (e) {
    if (browser) try { await browser.close(); } catch (_) {}
    res.status(500).json({ success: false, error: e.message });
  }
}
