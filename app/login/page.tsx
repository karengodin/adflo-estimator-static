"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid #d8e1ec",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
  color: "#0f1623",
  background: "#fff",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const [view, setView] = useState<"login" | "forgot" | "forgot-sent">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError]   = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/");
    });
  }, [router]);

  async function signIn() {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const { data: signInData, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) {
        setError(authErr.message);
      } else {
        document.cookie = `adfl-session=1; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
        const token = signInData.session?.access_token;
        fetch("/api/audit/event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ eventType: "login" }),
        }).catch(() => {});
        router.replace("/");
      }
    } finally {
      setLoading(false);
    }
  }

  async function sendResetLink() {
    if (!resetEmail.trim()) { setResetError("Email is required."); return; }
    setResetLoading(true);
    setResetError("");
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        resetEmail.trim(),
        { redirectTo: "https://adflo-implemenation-tools.vercel.app/auth/reset" },
      );
      if (resetErr) {
        setResetError(resetErr.message);
      } else {
        setView("forgot-sent");
      }
    } finally {
      setResetLoading(false);
    }
  }

  const logo = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
      <div
        style={{
          width: 36,
          height: 36,
          background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: "-0.04em",
          flexShrink: 0,
        }}
      >
        af
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.02em" }}>
        AdFlo Tools
      </span>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at top right, rgba(47,111,237,0.07), transparent 40%), linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #dde5ef",
          borderRadius: 24,
          padding: "48px 44px",
          width: 420,
          boxShadow: "0 8px 40px rgba(16,24,40,0.08)",
        }}
      >
        {logo}

        {/* ── Sign in ── */}
        {view === "login" && (
          <>
            <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Sign in
            </h1>
            <p style={{ margin: "0 0 28px", fontSize: 14, color: "#627286" }}>
              Internal tools for the AdFlo team.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#455468", marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="you@example.com"
                  autoFocus
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#455468", marginBottom: 6 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </div>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  color: "#dc2626",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <button
              onClick={signIn}
              disabled={loading || !email || !password}
              style={{
                marginTop: 20,
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #2f6fed, #1a4fb5)",
                color: "#fff",
                border: "none",
                fontSize: 15,
                fontWeight: 700,
                cursor: loading || !email || !password ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: loading || !email || !password ? 0.65 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>

            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                onClick={() => { setResetEmail(email); setResetError(""); setView("forgot"); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2f6fed",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                Forgot password?
              </button>
            </div>
          </>
        )}

        {/* ── Forgot password ── */}
        {view === "forgot" && (
          <>
            <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Reset password
            </h1>
            <p style={{ margin: "0 0 28px", fontSize: 14, color: "#627286" }}>
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#455468", marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendResetLink()}
                placeholder="you@example.com"
                autoFocus
                style={inputStyle}
              />
            </div>

            {resetError && (
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  color: "#dc2626",
                  fontSize: 13,
                }}
              >
                {resetError}
              </div>
            )}

            <button
              onClick={sendResetLink}
              disabled={resetLoading || !resetEmail.trim()}
              style={{
                marginTop: 20,
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #2f6fed, #1a4fb5)",
                color: "#fff",
                border: "none",
                fontSize: 15,
                fontWeight: 700,
                cursor: resetLoading || !resetEmail.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: resetLoading || !resetEmail.trim() ? 0.65 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {resetLoading ? "Sending…" : "Send reset link →"}
            </button>

            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                onClick={() => setView("login")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#627286",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                ← Back to sign in
              </button>
            </div>
          </>
        )}

        {/* ── Sent confirmation ── */}
        {view === "forgot-sent" && (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Check your email
            </h1>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#627286" }}>
              We sent a password reset link to <strong>{resetEmail}</strong>. Click the link in that email to set a new password.
            </p>
            <button
              onClick={() => setView("login")}
              style={{
                background: "none",
                border: "none",
                color: "#2f6fed",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
