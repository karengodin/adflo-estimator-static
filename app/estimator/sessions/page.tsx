"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type SessionRow = {
  id: string;
  company_name: string | null;
  primary_contact: string | null;
  answers: Record<string, string>;
  estimated_hours: number;
  tier: string;
  timeline: string | null;
  submitted_at: string;
  status: string | null;
  updated_at: string | null;
};

export default function EstimatorSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchSessions = async () => {
      const { data, error } = await supabase
        .from("estimator_submissions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) console.error("Error fetching sessions:", error);
      else setSessions((data as SessionRow[]) || []);
      setLoading(false);
    };
    fetchSessions();
  }, []);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const company = s.company_name?.toLowerCase() || "";
      const contact = s.primary_contact?.toLowerCase() || "";
      return company.includes(q) || contact.includes(q);
    });
  }, [sessions, search]);

  const avgHours =
    sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + (s.estimated_hours || 0), 0) / sessions.length)
      : 0;
  const enterpriseCount = sessions.filter((s) => s.tier === "Enterprise").length;

  const getProgress = (answers: Record<string, string>) => {
    const answered = Object.keys(answers || {}).length;
    return { answered, total: 40, pct: Math.min((answered / 40) * 100, 100) };
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* Page header */}
      <div style={{ marginBottom: 28, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>
            Sessions
          </h1>
          <p style={{ marginTop: 6, color: "#627286", fontSize: 14, margin: "6px 0 0" }}>
            Review and manage implementation estimate sessions.
          </p>
        </div>
        <Link href="/estimator" style={outlineButtonStyle}>
          ← Back to Estimator
        </Link>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard value={String(sessions.length)} label="Total Sessions" accent="#2f6fed" />
        <StatCard value={String(sessions.length)} label="Submitted" accent="#4fbf9f" />
        <StatCard value={String(avgHours)} label="Avg Est. Hours" accent="#7c5cbf" />
        <StatCard value={String(enterpriseCount)} label="Enterprise Tier" accent="#e8974a" />
      </div>

      {/* Table card */}
      <div style={{ background: "#ffffff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>

        {/* Table header row */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
            All Sessions
            {sessions.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, background: "#eaf1ff", color: "#2f6fed", padding: "2px 8px", borderRadius: 999, border: "1px solid #cddcff" }}>
                {sessions.length}
              </span>
            )}
          </div>
          <input
            type="search"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 210,
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #dde5ef",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              color: "#18212b",
              background: "#f8fafc",
            }}
          />
        </div>

        {loading ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#627286", fontSize: 14 }}>
            <div style={spinnerStyle} />
            <div style={{ marginTop: 12 }}>Loading sessions…</div>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#8a9bb0", fontSize: 14 }}>
            {search ? `No sessions matching "${search}"` : "No sessions yet."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Tier</th>
                  <th style={thStyle}>Est. Hours</th>
                  <th style={thStyle}>Progress</th>
                  <th style={thStyle}>Rep</th>
                  <th style={thStyle}>Updated</th>
                  <th style={{ ...thStyle, width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session, i) => {
                  const progress = getProgress(session.answers);
                  const isLast = i === filteredSessions.length - 1;
                  return (
                    <tr
                      key={session.id}
                      style={{ transition: "background 0.12s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ ...tdStyleStrong, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        {session.company_name || "—"}
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        <span style={getStatusBadgeStyle(session.status || "submitted")}>
                          {session.status || "submitted"}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        <span style={getTierBadgeStyle(session.tier)}>• {session.tier}</span>
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7", fontVariantNumeric: "tabular-nums" }}>
                        {session.estimated_hours} hrs
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 72, height: 4, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ width: `${progress.pct}%`, height: "100%", background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", borderRadius: 999 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "#8a9bb0", fontVariantNumeric: "tabular-nums" }}>
                            {progress.answered}/{progress.total}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        {session.primary_contact || "—"}
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7", color: "#8a9bb0" }}>
                        {formatDate(session.updated_at || session.submitted_at)}
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                        <Link href={`/estimator/sessions/${session.id}`} style={openButtonStyle}>
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #dde5ef",
      borderRadius: 16,
      padding: "18px 20px",
      boxShadow: "0 1px 3px rgba(16,24,40,0.04)",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: accent, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 5, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 18px",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#8a9bb0",
  fontWeight: 700,
  borderBottom: "1px solid #dde5ef",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "13px 18px",
  color: "#455468",
  verticalAlign: "middle",
};

const tdStyleStrong: React.CSSProperties = {
  ...tdStyle,
  fontWeight: 600,
  color: "#0f1623",
};

const outlineButtonStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  background: "#ffffff",
  color: "#455468",
  fontWeight: 600,
  textDecoration: "none",
  fontSize: 13.5,
  display: "inline-block",
  whiteSpace: "nowrap",
};

const openButtonStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 13px",
  borderRadius: 999,
  border: "1px solid #dde5ef",
  background: "#f8fafc",
  color: "#455468",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  fontSize: 12.5,
  transition: "all 0.15s",
};

const spinnerStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid #dde5ef",
  borderTopColor: "#2f6fed",
  borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
  margin: "0 auto",
};

function getStatusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "capitalize",
  };
  if (status === "draft") return { ...base, background: "#fff8e8", color: "#8a6417", border: "1px solid #f3e0a3" };
  if (status === "reviewed") return { ...base, background: "#edf8f2", color: "#1f9d55", border: "1px solid #cfe7d7" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}

function getTierBadgeStyle(tier: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  };
  if (tier === "Bronze") return { ...base, background: "#fdf1e5", color: "#a8611a", border: "1px solid #f1d3b2" };
  if (tier === "Silver") return { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #dbe3ec" };
  if (tier === "Gold") return { ...base, background: "#fff7db", color: "#9a6b00", border: "1px solid #f1dd8c" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}
