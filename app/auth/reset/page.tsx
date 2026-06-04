"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

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

function ResetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"verifying" | "form" | "error" | "success">("verifying");
  const [verifyError, setVerifyError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (!tokenHash || type !== "recovery") {
      setVerifyError("Invalid or missing reset link. Please request a new one from the sign-in page.");
      setStatus("error");
      return;
    }

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: "recovery" })
      .then(({ error }) => {
        if (error) {
          setVerifyError(error.message);
          setStatus("error");
        } else {
          setStatus("form");
        }
      });
  }, [searchParams]);

  async function setNewPassword() {
    setFormError("");
    if (!password) { setFormError("Password is required."); return; }
    if (password.length < 8) { setFormError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setFormError("Passwords do not match."); return; }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message);
      } else {
        setStatus("success");
        setTimeout(() => router.replace("/"), 1500);
      }
    } finally {
      setSaving(false);
    }
  }

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
        {/* Logo */}
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

        {status === "verifying" && (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Verifying reset link…
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#627286" }}>Just a moment.</p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Invalid reset link
            </h1>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                color: "#dc2626",
                fontSize: 13,
              }}
            >
              {verifyError}
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => router.push("/login")}
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
            </div>
          </>
        )}

        {status === "form" && (
          <>
            <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Set new password
            </h1>
            <p style={{ margin: "0 0 28px", fontSize: 14, color: "#627286" }}>
              Choose a new password for your AdFlo Tools account.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#455468", marginBottom: 6 }}>
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setNewPassword()}
                  placeholder="Min. 8 characters"
                  autoFocus
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#455468", marginBottom: 6 }}>
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setNewPassword()}
                  placeholder="Re-enter password"
                  style={inputStyle}
                />
              </div>
            </div>

            {formError && (
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
                {formError}
              </div>
            )}

            <button
              onClick={setNewPassword}
              disabled={saving}
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
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: saving ? 0.65 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {saving ? "Saving…" : "Set password →"}
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.03em" }}>
              Password updated!
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#627286" }}>
              Redirecting you to AdFlo Tools…
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetContent />
    </Suspense>
  );
}
