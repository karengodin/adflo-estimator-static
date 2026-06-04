"use client";

import { useEffect, useState } from "react";
import { useRole } from "../../lib/hooks/useRole";
import { supabase } from "../../lib/supabase";

const ROLE_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  admin:          { bg: "rgba(168,85,247,0.12)",  color: "#c084fc", border: "rgba(168,85,247,0.3)" },
  implementation: { bg: "rgba(0,196,204,0.10)",   color: "#00C4CC", border: "rgba(0,196,204,0.3)" },
  sales:          { bg: "rgba(234,179,8,0.10)",   color: "#eab308", border: "rgba(234,179,8,0.3)"  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#131d28",
        border: "1px solid #1e2d3d",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid #1e2d3d",
          fontSize: 12,
          fontWeight: 600,
          color: "#7a8fa3",
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
        }}
      >
        {title}
      </div>
      <div style={{ padding: "22px" }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "#7a8fa3",
          marginBottom: 7,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0f1720",
  border: "1px solid #1e2d3d",
  borderRadius: 10,
  color: "#e8edf2",
  fontFamily: "inherit",
  fontSize: 14,
  padding: "10px 14px",
  outline: "none",
  boxSizing: "border-box",
};

const readonlyStyle: React.CSSProperties = {
  ...inputStyle,
  color: "#7a8fa3",
  cursor: "default",
};

export default function AccountPage() {
  const { userId, userEmail, displayName, role, isLoading, accessToken } = useRole();

  const [name, setName]           = useState("");
  const [nameSaving, setNameSaving]   = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError]     = useState("");

  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwSuccess, setPwSuccess]   = useState(false);
  const [pwError, setPwError]       = useState("");

  // Initialise the name field once the role hook resolves
  useEffect(() => {
    if (!isLoading) setName(displayName ?? "");
  }, [isLoading, displayName]);

  async function saveName() {
    if (!userId) return;
    setNameSaving(true);
    setNameError("");
    setNameSuccess(false);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ display_name: name.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        setNameError(d.error ?? "Failed to save");
      } else {
        setNameSuccess(true);
        setTimeout(() => setNameSuccess(false), 2500);
      }
    } finally {
      setNameSaving(false);
    }
  }

  async function changePassword() {
    setPwError("");
    setPwSuccess(false);
    if (!newPw) { setPwError("New password is required."); return; }
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setPwError("Passwords do not match."); return; }

    setPwSaving(true);
    try {
      // Re-authenticate with current password first to confirm identity
      if (currentPw && userEmail) {
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: currentPw,
        });
        if (authErr) { setPwError("Current password is incorrect."); return; }
      }

      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) {
        setPwError(error.message);
      } else {
        setPwSuccess(true);
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
        setTimeout(() => setPwSuccess(false), 3000);
      }
    } finally {
      setPwSaving(false);
    }
  }

  if (isLoading) {
    return <div style={{ padding: 48, color: "#7a8fa3", fontSize: 14 }}>Loading…</div>;
  }

  const roleStyle = ROLE_STYLE[role ?? ""] ?? { bg: "rgba(61,81,102,0.3)", color: "#7a8fa3", border: "rgba(61,81,102,0.4)" };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 20 }}>

      {/* Header */}
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#e8edf2", letterSpacing: "-0.02em" }}>
          My Account
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#7a8fa3" }}>
          Manage your profile and password.
        </p>
      </div>

      {/* Profile */}
      <Section title="Profile">
        <Field label="Display name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#00C4CC")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d3d")}
          />
        </Field>

        <Field label="Email">
          <input type="email" value={userEmail ?? ""} readOnly style={readonlyStyle} />
        </Field>

        <Field label="Role">
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: roleStyle.bg,
                color: roleStyle.color,
                border: `1px solid ${roleStyle.border}`,
                textTransform: "capitalize",
              }}
            >
              {role ?? "—"}
            </span>
          </div>
        </Field>

        {nameError && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 13, marginBottom: 14 }}>
            {nameError}
          </div>
        )}
        {nameSuccess && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(0,196,204,0.08)", border: "1px solid rgba(0,196,204,0.2)", color: "#00C4CC", fontSize: 13, marginBottom: 14 }}>
            Display name saved.
          </div>
        )}

        <button
          onClick={saveName}
          disabled={nameSaving}
          style={{
            padding: "10px 20px",
            background: "#00C4CC",
            color: "#0a0f14",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            cursor: nameSaving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: nameSaving ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {nameSaving ? "Saving…" : "Save name"}
        </button>
      </Section>

      {/* Password */}
      <Section title="Change Password">
        <Field label="Current password">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Enter current password"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#00C4CC")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d3d")}
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Min. 8 characters"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#00C4CC")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d3d")}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePassword()}
            placeholder="Re-enter new password"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#00C4CC")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d3d")}
          />
        </Field>

        {pwError && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 13, marginBottom: 14 }}>
            {pwError}
          </div>
        )}
        {pwSuccess && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(0,196,204,0.08)", border: "1px solid rgba(0,196,204,0.2)", color: "#00C4CC", fontSize: 13, marginBottom: 14 }}>
            Password updated successfully.
          </div>
        )}

        <button
          onClick={changePassword}
          disabled={pwSaving}
          style={{
            padding: "10px 20px",
            background: "#00C4CC",
            color: "#0a0f14",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            cursor: pwSaving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: pwSaving ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {pwSaving ? "Updating…" : "Update password"}
        </button>
      </Section>

    </div>
  );
}
