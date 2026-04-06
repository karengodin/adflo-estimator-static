"use client";

import { useEffect, useState } from "react";

type TapClicksInstance = {
  id: string;
  instance_key: string;
  label: string;
  base_url: string;
  login_email: string;
  is_active: boolean;
  encrypted_cookie?: string | null;
  last_login_at: string | null;
  last_login_status: string | null;
  last_error: string | null;
};

export default function InstancesPage() {
  const [instances, setInstances] = useState<TapClicksInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [instanceKey, setInstanceKey] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionCookie, setSessionCookie] = useState("");

  const loadInstances = async () => {
    setLoading(true);
    const res = await fetch("/api/tapclicks-instances");
    const data = await res.json();
    setInstances(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadInstances();
  }, []);

const handleSave = async () => {
  if (!instanceKey || !label || !baseUrl || !loginEmail) {
    alert("Please fill in instance key, label, base URL, and login email.");
    return;
  }

  try {
    setSaving(true);

    const res = await fetch("/api/tapclicks-instances", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instance_key: instanceKey.trim().toUpperCase(),
        label: label.trim(),
        base_url: baseUrl.trim(),
        login_email: loginEmail.trim(),
        password: password.trim(),
        session_cookie: sessionCookie.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Failed to save instance.");
      return;
    }

    setInstanceKey("");
    setLabel("");
    setBaseUrl("");
    setLoginEmail("");
    setPassword("");
    setSessionCookie("");

    await loadInstances();
  } catch (error) {
    console.error("Save instance error:", error);
    alert("Failed to save instance.");
  } finally {
    setSaving(false);
  }
};
  const handleTestConnection = async (id: string) => {
  const res = await fetch(`/api/tapclicks-instances/${id}/test`, {
    method: "POST",
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || "Test connection failed.");
    return;
  }

  await loadInstances();
  alert("Connection successful.");
};

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: "0 auto" }}>
      <h1>TapClicks Instance Manager</h1>
      <p style={{ color: "#627286" }}>
        Store and manage shared instance credentials for Migration and AdfloXtract.
      </p>

      <div
        style={{
          background: "#fff",
          border: "1px solid #d8e1ec",
          borderRadius: 16,
          padding: 20,
          marginTop: 20,
          marginBottom: 24,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Add or Update Instance</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <input
            placeholder="Instance Key (e.g. AUDACY)"
            value={instanceKey}
            onChange={(e) => setInstanceKey(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Login Email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ ...inputStyle, gridColumn: "1 / span 2" }}
          />
          <textarea
  placeholder="Session Cookie (paste from browser DevTools)"
  value={sessionCookie}
  onChange={(e) => setSessionCookie(e.target.value)}
  style={{
    ...inputStyle,
    gridColumn: "1 / span 2",
    minHeight: 110,
    resize: "vertical",
    fontFamily: "monospace",
  }}
/>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving} style={buttonStyle}>
            {saving ? "Saving..." : "Save Instance"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #d8e1ec",
          borderRadius: 16,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Saved Instances</h2>

        {loading ? (
          <p>Loading...</p>
        ) : instances.length === 0 ? (
          <p style={{ color: "#627286" }}>No instances saved yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Key</th>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>URL</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Cookie</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last Login</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id}>
                  <td style={tdStyle}>{instance.instance_key}</td>
                  <td style={tdStyle}>{instance.label}</td>
                  <td style={tdStyle}>{instance.base_url}</td>
                  <td style={tdStyle}>{instance.login_email}</td>
                  <td style={tdStyle}>{instance.encrypted_cookie ? "Stored" : "—"}</td>
                  <td style={tdStyle}>{instance.last_login_status || "—"}</td>
                  <td style={tdStyle}>{instance.last_login_at ? new Date(instance.last_login_at).toLocaleString()
                      : "—"}
                  </td>
                  <td style={tdStyle}>
  <button
    onClick={() => handleTestConnection(instance.id)}
    style={{
      padding: "8px 12px",
      borderRadius: 10,
      border: "1px solid #d8e1ec",
      background: "#fff",
      cursor: "pointer",
      fontWeight: 600,
    }}
  >
    Test Connection
  </button>
</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d8e1ec",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 12,
  border: "none",
  background: "#2f6fed",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #d8e1ec",
  fontSize: 12,
  textTransform: "uppercase",
  color: "#627286",
};

const tdStyle: React.CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid #eef3f8",
  fontSize: 14,
};