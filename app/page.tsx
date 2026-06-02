"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRole } from "../lib/hooks/useRole";

type Session = {
  id: string;
  company_name: string;
  estimated_hours: number;
  tier: string;
  updated_at: string | null;
  primary_contact: string | null;
};

const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  Bronze:     { bg: "#fef6e9", color: "#b08d57" },
  Silver:     { bg: "#f1f5f9", color: "#64748b" },
  Gold:       { bg: "#fffbeb", color: "#d97706" },
  Enterprise: { bg: "#f3e8ff", color: "#7c3aed" },
};

function tierBadge(tier: string) {
  const s = TIER_STYLE[tier] ?? { bg: "#f0f4f9", color: "#627286" };
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {tier}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function HomePage() {
  const { isSales, isAdmin, isImplementation, isLoading, userEmail } = useRole();

  const [sessions, setSessions]   = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    fetch("/api/estimator/sessions")
      .then((r) => r.json())
      .then((data: Session[]) => {
        let visible = data;
        if (isSales && userEmail) {
          visible = data.filter((s) => s.primary_contact === userEmail);
        }
        setSessions(visible);
      })
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [isLoading, isSales, userEmail]);

  if (isLoading) {
    return <div style={{ padding: 48, color: "#627286", fontSize: 14 }}>Loading…</div>;
  }

  const recentSessions = sessions.slice(0, 3);
  const hasAnySessions = sessions.length > 0;

  const tools = [
    {
      href: "/estimator",
      icon: "📋",
      name: "adfloEstimate",
      desc: "Scope new implementations with 29-question estimates, generate SRDs, and track projects through go-live.",
      visible: true,
    },
    {
      href: "/interview",
      icon: "💬",
      name: "adfloInterview",
      desc: "Conduct AI-powered discovery conversations with clients that auto-generate estimates and workbooks.",
      visible: true,
    },
    {
      href: "/adfloxtract",
      icon: "🔁",
      name: "adfloXtract",
      desc: "Extract and export configuration data from Classic TapClicks instances.",
      visible: !isSales,
    },
    {
      href: "/migration",
      icon: "↔️",
      name: "adfloMigrate",
      desc: "Migrate Classic TapClicks configurations to AdFlo with AI-assisted task form assignment.",
      visible: !isSales,
    },
  ].filter((t) => t.visible);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 36 }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, #0f1623 0%, #1a2d4f 100%)",
          borderRadius: 20,
          padding: "36px 40px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          boxShadow: "0 4px 24px rgba(15,22,35,0.14)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-0.04em",
            flexShrink: 0,
          }}
        >
          af
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            Welcome to AdFlo Tools
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
            Your implementation platform for scoping, configuring, and tracking AdFlo deployments.
          </p>
        </div>
      </div>

      {/* ── Tools ────────────────────────────────────────────────────────── */}
      <section>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
          Tools
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          {tools.map((tool) => (
            <div
              key={tool.href}
              style={{
                background: "#fff",
                border: "1px solid #dde5ef",
                borderRadius: 16,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 1px 4px rgba(16,24,40,0.04)",
                transition: "box-shadow 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(47,111,237,0.1)";
                (e.currentTarget as HTMLDivElement).style.borderColor = "#cddcff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(16,24,40,0.04)";
                (e.currentTarget as HTMLDivElement).style.borderColor = "#dde5ef";
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      background: "#f0f4f9",
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  >
                    {tool.icon}
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
                    {tool.name}
                  </span>
                </div>
                <Link
                  href={tool.href as Parameters<typeof Link>[0]["href"]}
                  style={{
                    padding: "6px 14px",
                    background: "linear-gradient(135deg, #2f6fed, #1a4fb5)",
                    color: "#fff",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Open →
                </Link>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#627286", lineHeight: 1.55 }}>
                {tool.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Getting started (only if no sessions yet) ─────────────────────── */}
      {!sessionsLoading && !hasAnySessions && (
        <section>
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
            Getting Started
          </h2>
          <div
            style={{
              background: "#fff",
              border: "1px solid #dde5ef",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 1px 4px rgba(16,24,40,0.04)",
            }}
          >
            {[
              {
                step: "1",
                title: "Start with an estimate",
                desc: "Use adfloEstimate or adfloInterview to scope your first client",
                href: "/estimator",
                linkLabel: "Open adfloEstimate",
              },
              {
                step: "2",
                title: "Generate an SRD",
                desc: "Produce a client-ready scoping document from your estimate",
                href: "/estimator",
                linkLabel: null,
              },
              {
                step: "3",
                title: "Create a project",
                desc: "Track the implementation through Discovery, Pilot, UAT, and Go-Live",
                href: "/estimator",
                linkLabel: null,
              },
            ].map((item, i, arr) => (
              <div
                key={item.step}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 16,
                  padding: "18px 22px",
                  borderBottom: i < arr.length - 1 ? "1px solid #edf2f7" : "none",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #2f6fed, #1a4fb5)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {item.step}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623", marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: "#627286" }}>{item.desc}</div>
                </div>
                {item.linkLabel && (
                  <Link
                    href={item.href as Parameters<typeof Link>[0]["href"]}
                    style={{ fontSize: 12, fontWeight: 600, color: "#2f6fed", textDecoration: "none", whiteSpace: "nowrap", marginTop: 3 }}
                  >
                    {item.linkLabel} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent activity ───────────────────────────────────────────────── */}
      {!sessionsLoading && recentSessions.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
              Recent Activity
            </h2>
            <Link
              href="/estimator"
              style={{ fontSize: 12, fontWeight: 600, color: "#2f6fed", textDecoration: "none" }}
            >
              View all →
            </Link>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #dde5ef",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 1px 4px rgba(16,24,40,0.04)",
            }}
          >
            {recentSessions.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px 22px",
                  borderBottom: i < recentSessions.length - 1 ? "1px solid #edf2f7" : "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "#eaf1ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  📋
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f1623", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.company_name || "Untitled"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {tierBadge(s.tier)}
                    <span style={{ fontSize: 12, color: "#8a9bb0" }}>{s.estimated_hours} hrs</span>
                    <span style={{ fontSize: 12, color: "#c8d4e0" }}>·</span>
                    <span style={{ fontSize: 12, color: "#8a9bb0" }}>Updated {fmtDate(s.updated_at)}</span>
                  </div>
                </div>
                <Link
                  href={`/estimator/sessions/${s.id}` as Parameters<typeof Link>[0]["href"]}
                  style={{
                    padding: "6px 14px",
                    border: "1px solid #d8e1ec",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#455468",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    background: "#fff",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "#f0f4f9";
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = "#b8c8dd";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "#fff";
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = "#d8e1ec";
                  }}
                >
                  Open →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Bottom spacer ─────────────────────────────────────────────────── */}
      <div style={{ height: 8 }} />

    </div>
  );
}
