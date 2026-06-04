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

const TIER_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  Bronze:     { bg: "rgba(180,120,60,0.12)",  color: "#c4834a", border: "rgba(180,120,60,0.25)" },
  Silver:     { bg: "rgba(122,143,163,0.12)", color: "#7a8fa3", border: "rgba(122,143,163,0.25)" },
  Gold:       { bg: "rgba(200,160,0,0.12)",   color: "#c8a000", border: "rgba(200,160,0,0.25)" },
  Enterprise: { bg: "rgba(140,80,220,0.12)",  color: "#9b6ed4", border: "rgba(140,80,220,0.25)" },
};

function TierBadge({ tier }: { tier: string }) {
  const s = TIER_STYLE[tier] ?? { bg: "rgba(61,81,102,0.3)", color: "#7a8fa3", border: "rgba(61,81,102,0.4)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {tier}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function HomePage() {
  const { isSales, isLoading, userEmail } = useRole();

  const [sessions, setSessions]               = useState<Session[]>([]);
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
    return <div style={{ padding: 48, color: "#7a8fa3", fontSize: 14 }}>Loading…</div>;
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
    /* Bleed through the layout's 28px padding to fill the content area */
    <div
      style={{
        margin: -28,
        padding: 28,
        minHeight: "calc(100vh - 60px)",
        background: "#0a0f14",
        display: "grid",
        gap: 28,
        alignContent: "start",
      }}
    >
      <div style={{ maxWidth: 880, width: "100%", margin: "0 auto", display: "grid", gap: 28 }}>

        {/* ── Welcome banner ─────────────────────────────────────────────── */}
        <div
          style={{
            background: "#131d28",
            border: "1px solid #1e2d3d",
            borderLeft: "4px solid #00C4CC",
            borderRadius: 16,
            padding: "28px 32px",
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <img
            src="/adflologo.svg"
            alt="AdFlo"
            style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0 }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8edf2", letterSpacing: "-0.02em" }}>
              Welcome to AdFlo Tools
            </h1>
            <p style={{ margin: "5px 0 0", fontSize: 14, color: "#7a8fa3", lineHeight: 1.5 }}>
              Your implementation platform for scoping, configuring, and tracking AdFlo deployments.
            </p>
          </div>
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────── */}
        <section>
          <h2 style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 600, color: "#7a8fa3", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Tools
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
            {tools.map((tool) => (
              <ToolCard key={tool.href} tool={tool} />
            ))}
          </div>
        </section>

        {/* ── Getting started ────────────────────────────────────────────── */}
        {!sessionsLoading && !hasAnySessions && (
          <section>
            <h2 style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 600, color: "#7a8fa3", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Getting Started
            </h2>
            <div style={{ background: "#131d28", border: "1px solid #1e2d3d", borderRadius: 16, overflow: "hidden" }}>
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
                    padding: "18px 24px",
                    borderBottom: i < arr.length - 1 ? "1px solid #162030" : "none",
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: "rgba(0,196,204,0.12)",
                      border: "1px solid rgba(0,196,204,0.3)",
                      color: "#00C4CC",
                      fontSize: 11,
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
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e8edf2", marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 13, color: "#7a8fa3" }}>{item.desc}</div>
                  </div>
                  {item.linkLabel && (
                    <Link
                      href={item.href as Parameters<typeof Link>[0]["href"]}
                      style={{ fontSize: 12, fontWeight: 600, color: "#00C4CC", textDecoration: "none", whiteSpace: "nowrap", marginTop: 3 }}
                    >
                      {item.linkLabel} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Recent activity ─────────────────────────────────────────────── */}
        {!sessionsLoading && recentSessions.length > 0 && (
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "#7a8fa3", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Recent Activity
              </h2>
              <Link href="/estimator" style={{ fontSize: 12, fontWeight: 600, color: "#00C4CC", textDecoration: "none" }}>
                View all →
              </Link>
            </div>
            <div style={{ background: "#131d28", border: "1px solid #1e2d3d", borderRadius: 16, overflow: "hidden" }}>
              {recentSessions.map((s, i) => (
                <ActivityRow key={s.id} s={s} isLast={i === recentSessions.length - 1} />
              ))}
            </div>
          </section>
        )}

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: { href: string; icon: string; name: string; desc: string } }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        background: "#182130",
        border: `1px solid ${hovered ? "#00C4CC" : "#1e2d3d"}`,
        borderRadius: 16,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: hovered ? "0 0 0 1px #00C4CC, 0 8px 24px rgba(0,196,204,0.1)" : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              background: "rgba(0,196,204,0.08)",
              border: "1px solid rgba(0,196,204,0.18)",
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
          <span style={{ fontSize: 18, fontWeight: 700, color: "#ffffff" }}>
            {tool.name}
          </span>
        </div>
        <OpenBtn href={tool.href} />
      </div>
      <p style={{ margin: 0, fontSize: 14, color: "#a8bbc9", lineHeight: 1.55 }}>
        {tool.desc}
      </p>
    </div>
  );
}

function OpenBtn({ href }: { href: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href as Parameters<typeof Link>[0]["href"]}
      style={{
        padding: "6px 14px",
        background: hovered ? "#00a8b0" : "#00C4CC",
        color: "#0a0f14",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "background 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Open →
    </Link>
  );
}

function ActivityRow({ s, isLast }: { s: Session; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "15px 22px",
        borderBottom: isLast ? "none" : "1px solid #162030",
        background: hovered ? "#131d28" : "transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "rgba(0,196,204,0.08)",
          border: "1px solid rgba(0,196,204,0.15)",
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
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "#e8edf2",
            marginBottom: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {s.company_name || "Untitled"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <TierBadge tier={s.tier} />
          <span style={{ fontSize: 13, color: "#7a8fa3" }}>{s.estimated_hours} hrs</span>
          <span style={{ fontSize: 13, color: "#1e2d3d" }}>·</span>
          <span style={{ fontSize: 13, color: "#7a8fa3" }}>Updated {fmtDate(s.updated_at)}</span>
        </div>
      </div>
      <ActivityOpenBtn id={s.id} />
    </div>
  );
}

function ActivityOpenBtn({ id }: { id: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={`/estimator/sessions/${id}` as Parameters<typeof Link>[0]["href"]}
      style={{
        padding: "6px 14px",
        border: `1px solid ${hovered ? "#00C4CC" : "#1e2d3d"}`,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        color: hovered ? "#00C4CC" : "#7a8fa3",
        textDecoration: "none",
        whiteSpace: "nowrap",
        flexShrink: 0,
        background: "transparent",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Open →
    </Link>
  );
}
