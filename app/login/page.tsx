"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function DarkInput({
  type,
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoFocus,
}: {
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        padding: "11px 14px",
        borderRadius: 10,
        border: `1px solid ${focused ? "#00C4CC" : "#1e2d3d"}`,
        fontSize: 14,
        fontFamily: "inherit",
        boxSizing: "border-box",
        outline: "none",
        color: "#e8edf2",
        background: "#131d28",
        boxShadow: focused ? "0 0 0 3px rgba(0,196,204,0.15)" : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    />
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const [view, setView]             = useState<"login" | "forgot" | "forgot-sent">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError]     = useState("");

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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 32 }}>
      <img
        src="/adflologo.svg"
        alt="AdFlo"
        style={{ width: 64, height: 64, borderRadius: 14, display: "block" }}
      />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#e8edf2", letterSpacing: "-0.02em" }}>
          AdFlo Tools
        </div>
        <div style={{ fontSize: 13, color: "#7a8fa3", marginTop: 2 }}>
          Implementation Platform
        </div>
      </div>
    </div>
  );

  const errorBox = (msg: string) => (
    <div
      style={{
        marginTop: 14,
        padding: "10px 14px",
        borderRadius: 10,
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.25)",
        color: "#f87171",
        fontSize: 13,
      }}
    >
      {msg}
    </div>
  );

  const primaryBtn = (label: string, onClick: () => void, disabled: boolean) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        marginTop: 20,
        width: "100%",
        padding: "12px",
        borderRadius: 12,
        background: disabled ? "#00C4CC" : "#00C4CC",
        color: "#0a0f14",
        border: "none",
        fontSize: 15,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#00a8b0"; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#00C4CC"; }}
    >
      {label}
    </button>
  );

  const ghostBtn = (label: string, onClick: () => void, color = "#7a8fa3") => (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
        padding: 0,
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#e8edf2")}
      onMouseLeave={(e) => (e.currentTarget.style.color = color)}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0f14",
        backgroundImage: "radial-gradient(#1e2d3d 1.5px, transparent 1.5px)",
        backgroundSize: "22px 22px",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        style={{
          background: "#0f1720",
          border: "1px solid #1e2d3d",
          borderRadius: 24,
          padding: "44px 40px",
          width: 420,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {logo}

        {/* ── Sign in ── */}
        {view === "login" && (
          <>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#7a8fa3", marginBottom: 6 }}>
                  Email
                </label>
                <DarkInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#7a8fa3", marginBottom: 6 }}>
                  Password
                </label>
                <DarkInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && errorBox(error)}

            {primaryBtn(loading ? "Signing in…" : "Sign in →", signIn, loading || !email || !password)}

            <div style={{ marginTop: 16, textAlign: "center" }}>
              {ghostBtn("Forgot password?", () => { setResetEmail(email); setResetError(""); setView("forgot"); })}
            </div>
          </>
        )}

        {/* ── Forgot password ── */}
        {view === "forgot" && (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#e8edf2", marginBottom: 6 }}>Reset password</div>
              <div style={{ fontSize: 13, color: "#7a8fa3" }}>
                Enter your email and we&apos;ll send you a reset link.
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#7a8fa3", marginBottom: 6 }}>
                Email
              </label>
              <DarkInput
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendResetLink()}
                placeholder="you@example.com"
                autoFocus
              />
            </div>

            {resetError && errorBox(resetError)}

            {primaryBtn(resetLoading ? "Sending…" : "Send reset link →", sendResetLink, resetLoading || !resetEmail.trim())}

            <div style={{ marginTop: 16, textAlign: "center" }}>
              {ghostBtn("← Back to sign in", () => setView("login"))}
            </div>
          </>
        )}

        {/* ── Sent confirmation ── */}
        {view === "forgot-sent" && (
          <>
            <div
              style={{
                padding: "16px",
                borderRadius: 12,
                background: "rgba(0,196,204,0.08)",
                border: "1px solid rgba(0,196,204,0.2)",
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e8edf2", marginBottom: 6 }}>
                Check your email
              </div>
              <div style={{ fontSize: 13, color: "#7a8fa3", lineHeight: 1.5 }}>
                We sent a reset link to <strong style={{ color: "#e8edf2" }}>{resetEmail}</strong>. Click the link to set a new password.
              </div>
            </div>
            {ghostBtn("← Back to sign in", () => setView("login"), "#00C4CC")}
          </>
        )}
      </div>
    </div>
  );
}
