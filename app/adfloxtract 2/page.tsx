"use client";

import Link from "next/link";

const adfloXtractUrl = process.env.NEXT_PUBLIC_ADFLOXTRACT_URL;

export default function AdfloXtractPage() {
  if (!adfloXtractUrl) {
    return (
      <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>AdfloXtract</h1>
        <p style={{ color: "#627286", marginBottom: 24 }}>
          The AdfloXtract deployment URL has not been configured yet.
        </p>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #d8e1ec",
            borderRadius: 18,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Next step</div>
          <div style={{ color: "#455468", lineHeight: 1.6 }}>
            Add <code>NEXT_PUBLIC_ADFLOXTRACT_URL</code> to <code>.env.local</code>,
            then restart the dev server.
          </div>
        </div>

        <Link
          href="/"
          style={{
            color: "#627286",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #d8e1ec",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>AdfloXtract</h1>
          <p style={{ margin: "6px 0 0", color: "#627286", fontSize: 14 }}>
            Standalone workflow extraction tool
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href={adfloXtractUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "none",
              background: "#2f6fed",
              color: "#ffffff",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Open in New Tab
          </a>

          <Link
            href="/"
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid #d8e1ec",
              background: "#ffffff",
              color: "#455468",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      <iframe
        src={adfloXtractUrl}
        title="AdfloXtract"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "#ffffff",
        }}
      />
    </div>
  );
}