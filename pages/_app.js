import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

export default function App({ Component, pageProps }) {
  var s = useState, a;
  a = s(null); var installEvt = a[0], setInstallEvt = a[1];
  a = s(false); var showBanner = a[0], setShowBanner = a[1];
  a = s(false); var dismissed = a[0], setDismissed = a[1];
  a = s(false); var isStandalone = a[0], setIsStandalone = a[1];

  useEffect(function() {
    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function() {});
    }

    // Check if already installed (standalone mode)
    var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setIsStandalone(standalone);

    // Check if user previously dismissed (respect for 3 days)
    try {
      var dismissedAt = localStorage.getItem("pwa-dismissed");
      if (dismissedAt) {
        var elapsed = Date.now() - parseInt(dismissedAt);
        if (elapsed < 3 * 24 * 60 * 60 * 1000) {
          setDismissed(true);
        } else {
          localStorage.removeItem("pwa-dismissed");
        }
      }
    } catch(e) {}

    // Listen for browser install prompt
    function onPrompt(e) {
      e.preventDefault();
      setInstallEvt(e);
      setShowBanner(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Show iOS-specific banner after short delay (no beforeinstallprompt on iOS)
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
    var timer;
    if (isIos && !standalone) {
      timer = setTimeout(function() { setShowBanner(true); }, 2000);
    }
    // Also show for Android Chrome after delay if beforeinstallprompt hasn't fired
    var isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid && !standalone) {
      timer = setTimeout(function() { setShowBanner(true); }, 3000);
    }

    return function() {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (timer) clearTimeout(timer);
    };
  }, []);

  var handleInstall = useCallback(function() {
    if (installEvt) {
      installEvt.prompt();
      installEvt.userChoice.then(function(result) {
        if (result.outcome === "accepted") {
          setShowBanner(false);
          setIsStandalone(true);
        }
        setInstallEvt(null);
      });
    }
  }, [installEvt]);

  function handleDismiss() {
    setShowBanner(false);
    setDismissed(true);
    try { localStorage.setItem("pwa-dismissed", String(Date.now())); } catch(e) {}
  }

  var isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  var visible = showBanner && !dismissed && !isStandalone;

  return <>
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      <meta name="theme-color" content="#0a0a0f" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="TileExtract" />
      <link rel="manifest" href="/manifest.json" />
      <link rel="apple-touch-icon" href="/icon-192.png" />
      <title>Tile Extractor</title>
      <style>{"\
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }\
        @keyframes slideUp { from { transform: translateY(100px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }\
        * { -webkit-tap-highlight-color: transparent; }\
        body { margin: 0; background: #0a0a0f; }\
      "}</style>
    </Head>

    <Component {...pageProps} />

    {visible && <div style={B.overlay} onClick={handleDismiss}>
      <div style={B.popup} onClick={function(e) { e.stopPropagation(); }}>
        <div style={B.header}>
          <div style={B.icon}>
            <svg viewBox="0 0 512 512" width="44" height="44">
              <rect width="512" height="512" rx="80" fill="#0a0a0f" />
              <rect x="60" y="60" width="180" height="180" rx="16" fill="#3b82f6" opacity="0.9" />
              <rect x="272" y="60" width="180" height="180" rx="16" fill="#6ee7b7" opacity="0.9" />
              <rect x="60" y="272" width="180" height="180" rx="16" fill="#f59e0b" opacity="0.9" />
              <rect x="272" y="272" width="180" height="180" rx="16" fill="#8b5cf6" opacity="0.9" />
            </svg>
          </div>
          <div>
            <p style={B.title}>Install Tile Extractor</p>
            <p style={B.sub}>Add to home screen for a better experience</p>
          </div>
          <button onClick={handleDismiss} style={B.close}>X</button>
        </div>

        <div style={B.perks}>
          <div style={B.perk}>
            <span style={B.emoji}>{"⚡"}</span>
            <span>Full-screen, no browser bars</span>
          </div>
          <div style={B.perk}>
            <span style={B.emoji}>{"🔖"}</span>
            <span>Quick access from home screen</span>
          </div>
          <div style={B.perk}>
            <span style={B.emoji}>{"📱"}</span>
            <span>Feels like a native app</span>
          </div>
        </div>

        {installEvt && <button onClick={handleInstall} style={B.installBtn}>
          Install Now
        </button>}

        {!installEvt && isIos && <div style={B.iosGuide}>
          <p style={{fontSize: "0.78rem", color: "#fbbf24", fontWeight: 600, marginBottom: 6}}>On iOS Safari:</p>
          <p style={{fontSize: "0.74rem", color: "#ccc", lineHeight: 1.6}}>
            {"1. Tap the Share button "}<span style={{fontSize: "1.1rem"}}>{"⬆"}</span>{" at the bottom"}<br />
            {"2. Scroll down and tap \"Add to Home Screen\""}<br />
            {"3. Tap \"Add\" to confirm"}
          </p>
        </div>}

        {!installEvt && !isIos && <div style={B.iosGuide}>
          <p style={{fontSize: "0.78rem", color: "#fbbf24", fontWeight: 600, marginBottom: 6}}>On Chrome Android:</p>
          <p style={{fontSize: "0.74rem", color: "#ccc", lineHeight: 1.6}}>
            {"1. Tap the menu "}<span style={{fontSize: "1rem"}}>{"⋮"}</span>{" (top right)"}<br />
            {"2. Tap \"Add to Home screen\" or \"Install app\""}<br />
            {"3. Tap \"Install\" to confirm"}
          </p>
        </div>}

        <button onClick={handleDismiss} style={B.laterBtn}>Maybe later</button>
      </div>
    </div>}
  </>;
}

var B = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    zIndex: 9999, padding: 12,
    animation: "fadeIn 0.25s ease"
  },
  popup: {
    background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 16,
    padding: 20, width: "100%", maxWidth: 400,
    animation: "slideUp 0.3s ease",
    marginBottom: "env(safe-area-inset-bottom, 0px)"
  },
  header: {
    display: "flex", alignItems: "center", gap: 12, marginBottom: 16
  },
  icon: { flexShrink: 0 },
  title: { fontSize: "1rem", fontWeight: 700, color: "#fff", margin: 0 },
  sub: { fontSize: "0.72rem", color: "#888", margin: 0, marginTop: 2 },
  close: {
    marginLeft: "auto", background: "none", border: "none",
    color: "#666", fontSize: "1rem", cursor: "pointer", padding: 8
  },
  perks: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  perk: { display: "flex", alignItems: "center", gap: 10, fontSize: "0.78rem", color: "#ccc" },
  emoji: { fontSize: "1.1rem", width: 24, textAlign: "center" },
  installBtn: {
    width: "100%", padding: 14, background: "#3b82f6", color: "#fff",
    border: "none", borderRadius: 10, fontSize: "0.95rem", fontWeight: 700,
    cursor: "pointer", marginBottom: 8
  },
  iosGuide: {
    background: "#0d0d14", border: "1px solid #2a2a3a", borderRadius: 10,
    padding: 14, marginBottom: 8
  },
  laterBtn: {
    width: "100%", padding: 10, background: "none", color: "#666",
    border: "none", fontSize: "0.78rem", cursor: "pointer", textAlign: "center"
  }
};
