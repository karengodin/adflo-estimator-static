"use client";

import { useEffect, useState } from "react";

type Instance = {
  id: string;
  name: string;
  base_url: string;
  session_cookie: string | null;
  cookie_expires_at: string | null;
  last_connected_at: string | null;
};

type CookieStatus = "valid" | "expired" | "stored" | "none";

function getCookieStatus(instance: Instance): CookieStatus {
  if (!instance.session_cookie) return "none";
  if (!instance.cookie_expires_at) return "stored";
  return new Date(instance.cookie_expires_at) > new Date() ? "valid" : "expired";
}

const STATUS_LABEL: Record<CookieStatus, string> = {
  valid:   "Valid",
  expired: "Expired",
  stored:  "Stored",
  none:    "No cookie",
};

const STATUS_STYLE: Record<CookieStatus, React.CSSProperties> = {
  valid:   { background: "rgba(34,197,94,0.12)",   color: "#16a34a" },
  expired: { background: "rgba(239,68,68,0.12)",   color: "#dc2626" },
  stored:  { background: "rgba(47,111,237,0.10)",  color: "#2f6fed" },
  none:    { background: "rgba(148,163,184,0.12)", color: "#64748b" },
};

export default function InstancesPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [sessionCookie, setSessionCookie] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refresh cookie state: tracks which row is open + the new cookie value
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshCookie, setRefreshCookie] = useState("");
  const [refreshSaving, setRefreshSaving] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const loadInstances = async () => {
    setLoading(true);
    const res = await fetch("/api/tapclicks-instances");
    const data = await res.json();
    setInstances(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { loadInstances(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim() || !sessionCookie.trim()) return;
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/tapclicks-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        base_url: baseUrl.trim(),
        session_cookie: sessionCookie.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error || "Failed to save instance.");
    } else {
      setName("");
      setBaseUrl("");
      setSessionCookie("");
      await loadInstances();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this instance?")) return;
    await fetch(`/api/tapclicks-instances/${id}`, { method: "DELETE" });
    await loadInstances();
  };

  const handleRefreshOpen = (id: string) => {
    setRefreshingId(id);
    setRefreshCookie("");
    setRefreshError(null);
  };

  const handleRefreshSave = async (id: string) => {
    if (!refreshCookie.trim()) return;
    setRefreshSaving(true);
    setRefreshError(null);
    const res = await fetch(`/api/tapclicks-instances/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_cookie: refreshCookie.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRefreshError(data.error || "Failed to update cookie.");
    } else {
      setRefreshingId(null);
      setRefreshCookie("");
      await loadInstances();
    }
    setRefreshSaving(false);
  };

  return (
    <div style={{ padding: 32, maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f1623" }}>
          Instances
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#627286" }}>
          Add TapClicks instances by pasting a session cookie from browser DevTools.
        </p>
      </div>

      {/* ── Add instance form ── */}
      <form
        onSubmit={handleSave}
        style={{
          background: "#fff",
          border: "1px solid #dde5ef",
          borderRadius: 16,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, color: "#0f1623", marginBottom: 16 }}>
          Add Instance
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              placeholder="e.g. Audacy Adflo Preview"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Base URL</label>
            <input
              style={inputStyle}
              placeholder="https://preview.tapdemo.com"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              required
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          <label style={labelStyle}>Session Cookie</label>
          <textarea
            style={{ ...inputStyle, minHeight: 90, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            placeholder="Paste cookie string from browser DevTools → Application → Cookies"
            value={sessionCookie}
            onChange={e => setSessionCookie(e.target.value)}
            required
          />
        </div>

        {saveError && (
          <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{saveError}</div>
        )}

        <button
          type="submit"
          disabled={saving || !name.trim() || !baseUrl.trim() || !sessionCookie.trim()}
          style={{
            ...btnStyle,
            opacity: saving || !name.trim() || !baseUrl.trim() || !sessionCookie.trim() ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : "Save Instance"}
        </button>
      </form>

      {/* ── Instances table ── */}
      <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, overflow: "hidden" }}>
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid #dde5ef",
          fontSize: 13,
          fontWeight: 600,
          color: "#627286",
        }}>
          {loading ? "Loading…" : `${instances.length} instance${instances.length !== 1 ? "s" : ""}`}
        </div>

        {!loading && instances.length === 0 && (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
            No instances yet. Add one above.
          </div>
        )}

        {!loading && instances.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>URL</th>
                <th style={thStyle}>Cookie</th>
                <th style={{ ...thStyle, width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {instances.map(instance => {
                const status = getCookieStatus(instance);
                const isRefreshing = refreshingId === instance.id;

                return (
                  <>
                    <tr
                      key={instance.id}
                      style={{ borderTop: "1px solid #eef3f8" }}
                    >
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: "#0f1623" }}>{instance.name}</span>
                      </td>
                      <td style={tdStyle}>
                        <a
                          href={instance.base_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#2f6fed", fontSize: 13, textDecoration: "none" }}
                        >
                          {instance.base_url}
                        </a>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          ...STATUS_STYLE[status],
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "3px 10px",
                          borderRadius: 999,
                        }}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => isRefreshing ? setRefreshingId(null) : handleRefreshOpen(instance.id)}
                            style={{
                              ...ghostBtnStyle,
                              color: isRefreshing ? "#64748b" : "#2f6fed",
                              borderColor: isRefreshing ? "#dde5ef" : "#2f6fed22",
                            }}
                          >
                            {isRefreshing ? "Cancel" : "Refresh Cookie"}
                          </button>
                          <button
                            onClick={() => handleDelete(instance.id)}
                            style={{ ...ghostBtnStyle, color: "#dc2626", borderColor: "#fecaca" }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline refresh cookie row */}
                    {isRefreshing && (
                      <tr key={`${instance.id}-refresh`} style={{ background: "#f8fafc", borderTop: "1px solid #eef3f8" }}>
                        <td colSpan={4} style={{ padding: "14px 20px" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f1623", marginBottom: 8 }}>
                            Paste new session cookie for <em>{instance.name}</em>
                          </div>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <textarea
                              autoFocus
                              style={{
                                flex: 1,
                                ...inputStyle,
                                minHeight: 72,
                                resize: "vertical",
                                fontFamily: "monospace",
                                fontSize: 12,
                              }}
                              placeholder="Paste updated cookie string here…"
                              value={refreshCookie}
                              onChange={e => setRefreshCookie(e.target.value)}
                            />
                            <button
                              onClick={() => handleRefreshSave(instance.id)}
                              disabled={refreshSaving || !refreshCookie.trim()}
                              style={{
                                ...btnStyle,
                                opacity: refreshSaving || !refreshCookie.trim() ? 0.5 : 1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {refreshSaving ? "Saving…" : "Save Cookie"}
                            </button>
                          </div>
                          {refreshError && (
                            <div style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>{refreshError}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#627286",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "#2f6fed",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #dde5ef",
  background: "transparent",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 20px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#94a3b8",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 20px",
  fontSize: 14,
  verticalAlign: "middle",
};
