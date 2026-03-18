import { useState } from "react";

const PRESETS = [
  { label: "Overworld (Huanglong)", url: "https://wuthering.gg/map" },
  { label: "Rinascita", url: "https://wuthering.gg/map/rinascita" },
  { label: "Tethys Deep", url: "https://wuthering.gg/map/tethys-deep" },
  { label: "Lahai-Roi", url: "https://wuthering.gg/map/lahai-roi" },
  { label: "Roya Frostlands", url: "https://wuthering.gg/map/roya-frostlands" },
  { label: "Appsample Main", url: "https://wuthering-waves-map.appsample.com/" },
  { label: "Appsample Rinascita", url: "https://wuthering-waves-map.appsample.com/?map=rinascita" },
  { label: "TH.GL Overworld", url: "https://wuthering.th.gl/maps/Overworld" },
  { label: "TH.GL Lahai-Roi", url: "https://wuthering.th.gl/maps/Lahai-Roi" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);

  async function extract() {
    if (!url) return;
    setLoading(true);
    setResults(null);
    setStatus("Fetching & scanning...");

    try {
      const resp = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
      const data = await resp.json();

      if (data.error) {
        setStatus("Error: " + data.error);
      } else {
        const total = data.patterns.length + data.tiles.length;
        setStatus(
          total > 0
            ? `Found ${data.patterns.length} pattern(s), ${data.tiles.length} tile(s) — scanned ${data.scriptsScanned} JS bundles`
            : "No tiles found. Try another map site."
        );
        setResults(data);
      }
    } catch (e) {
      setStatus("Network error: " + e.message);
    }

    setLoading(false);
  }

  function getResultText() {
    if (!results) return "";
    let t = "Source: " + (results.sourceUrl || url) + "\n\n";
    if (results.patterns.length) {
      t += "=== TILE PATTERNS ===\n" + results.patterns.join("\n") + "\n\n";
    }
    if (results.tiles.length) {
      t += "=== SAMPLE TILES ===\n" + results.tiles.join("\n");
    }
    return t;
  }

  function copyAll() {
    navigator.clipboard.writeText(getResultText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = getResultText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🗺️ Leaflet Tile Extractor</h1>
      <p style={styles.subtitle}>
        Enter any interactive map URL — extracts tile URL patterns server-side (no CORS issues)
      </p>

      <div style={styles.card}>
        <p style={styles.label}>Quick pick a WuWa map:</p>
        <div style={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.url}
              onClick={() => setUrl(p.url)}
              style={{
                ...styles.preset,
                ...(url === p.url ? styles.presetActive : {}),
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p style={{ ...styles.label, marginTop: 16 }}>Or paste any URL:</p>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://wuthering.gg/map/rinascita"
          style={styles.input}
        />

        <button
          onClick={extract}
          disabled={loading || !url}
          style={{
            ...styles.btn,
            ...(loading ? styles.btnDisabled : styles.btnBlue),
          }}
        >
          {loading ? "⏳ Scanning..." : "🔍 Extract Tile URLs"}
        </button>

        {status && <p style={styles.status}>{status}</p>}
      </div>

      {results &&
        (results.patterns.length > 0 || results.tiles.length > 0) && (
          <div style={styles.card}>
            {results.patterns.length > 0 && (
              <>
                <p style={styles.sectionTitle}>
                  ✅ Tile Patterns ({results.patterns.length}):
                </p>
                {results.patterns.map((p, i) => (
                  <div key={i} style={styles.resultBox}>
                    {p}
                  </div>
                ))}
              </>
            )}

            {results.tiles.length > 0 && (
              <>
                <p style={{ ...styles.sectionTitle, marginTop: 16 }}>
                  🧩 Sample Tiles ({results.tiles.length}):
                </p>
                <div style={{ ...styles.resultBox, maxHeight: 200, overflowY: "auto" }}>
                  {results.tiles.map((t, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      {t}
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              onClick={copyAll}
              style={{
                ...styles.btn,
                ...(copied ? styles.btnGreen : { background: "#059669", color: "#fff" }),
                marginTop: 12,
              }}
            >
              {copied ? "✅ Copied!" : "📋 Copy All Results"}
            </button>
          </div>
        )}

      <div style={{ ...styles.card, marginTop: 20 }}>
        <p style={styles.sectionTitle}>How it works</p>
        <p style={styles.text}>
          1. Your URL is sent to our Vercel API route<br />
          2. The server fetches the page HTML (no CORS)<br />
          3. It finds all JS bundles and fetches those too<br />
          4. Regex scans everything for tile URL patterns<br />
          5. Results are sent back to you
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 600,
    margin: "0 auto",
    padding: 16,
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    background: "#0a0a0f",
    color: "#e0e0e8",
    minHeight: "100vh",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#6ee7b7",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: "0.8rem",
    color: "#777",
    marginBottom: 20,
  },
  card: {
    background: "#15151f",
    border: "1px solid #2a2a3a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  label: {
    fontSize: "0.85rem",
    color: "#aaa",
    marginBottom: 8,
  },
  presets: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  preset: {
    fontSize: "0.75rem",
    background: "#1e1e2e",
    color: "#93c5fd",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  presetActive: {
    background: "#1e3a5f",
    borderColor: "#3b82f6",
  },
  input: {
    width: "100%",
    padding: 12,
    background: "#0d0d14",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#eee",
    fontSize: "0.85rem",
    marginBottom: 10,
    boxSizing: "border-box",
  },
  btn: {
    display: "block",
    width: "100%",
    padding: 14,
    border: "none",
    borderRadius: 8,
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "#fff",
  },
  btnBlue: {
    background: "#3b82f6",
  },
  btnDisabled: {
    background: "#555",
    cursor: "not-allowed",
  },
  btnGreen: {
    background: "#047857",
  },
  status: {
    fontSize: "0.8rem",
    color: "#fbbf24",
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#fbbf24",
    marginBottom: 8,
  },
  resultBox: {
    background: "#0d0d14",
    border: "1px solid #2a2a3a",
    borderRadius: 6,
    padding: 10,
    fontFamily: "monospace",
    fontSize: "0.7rem",
    color: "#6ee7b7",
    wordBreak: "break-all",
    marginBottom: 6,
  },
  text: {
    fontSize: "0.8rem",
    lineHeight: 1.6,
    color: "#999",
  },
};
