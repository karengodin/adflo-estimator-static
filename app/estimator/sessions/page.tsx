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

      if (error) {
        console.error("Error fetching sessions:", error);
      } else {
        setSessions((data as SessionRow[]) || []);
      }

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

  const totalSessions = sessions.length;
  const submittedCount = sessions.length;
  const avgHours =
    sessions.length > 0
      ? Math.round(
          sessions.reduce((sum, s) => sum + (s.estimated_hours || 0), 0) /
            sessions.length
        )
      : 0;
  const enterpriseCount = sessions.filter((s) => s.tier === "Enterprise").length;

  const getProgress = (answers: Record<string, string>) => {
    const answered = Object.keys(answers || {}).length;
    return { answered, total: 40, pct: Math.min((answered / 40) * 100, 100) };
  };

  const formatDate = (value: string) => {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Sessions</h1>
          <p style={{ marginTop: 8, color: "#627286" }}>
            Review and manage implementation estimate sessions.
          </p>
        </div>

        <Link
          href="/estimator"
          style={{
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid #d8e1ec",
            background: "#ffffff",
            color: "#455468",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          ← Back to Estimator
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard value={String(totalSessions)} label="Total Sessions" />
        <StatCard value={String(submittedCount)} label="Submitted" />
        <StatCard value={String(avgHours)} label="Avg Est. Hours" />
        <StatCard value={String(enterpriseCount)} label="Enterprise Tier" />
      </div>

      <div
        style={{
          background: "#ffffff",
          border: "1px solid #d8e1ec",
          borderRadius: 20,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid #d8e1ec",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700 }}>All Sessions</div>
          <input
            type="search"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 220,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #d8e1ec",
              fontSize: 14,
            }}
          />
        </div>

        {loading ? (
          <div style={{ padding: 24 }}>Loading sessions...</div>
        ) : filteredSessions.length === 0 ? (
          <div style={{ padding: 24, color: "#627286" }}>No sessions found.</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Tier</th>
                <th style={thStyle}>Est. Hours</th>
                <th style={thStyle}>Progress</th>
                <th style={thStyle}>Rep</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => {
                const progress = getProgress(session.answers);

                return (
                  <tr key={session.id}>
                    <td style={tdStyleStrong}>{session.company_name || "—"}</td>
                    <td style={tdStyle}>
                      <span style={getStatusBadgeStyle(session.status || "submitted")}>
  {session.status || "submitted"}
</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={getTierBadgeStyle(session.tier)}>
                        • {session.tier}
                      </span>
                    </td>
                    <td style={tdStyle}>{session.estimated_hours} hrs</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 80,
                            height: 5,
                            background: "#e2e8f0",
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${progress.pct}%`,
                              height: "100%",
                              background:
                                "linear-gradient(90deg, #2f6fed, #4fbf9f)",
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, color: "#627286" }}>
                          {progress.answered}/{progress.total}
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>{session.primary_contact || "—"}</td>
                    <td style={tdStyle}>{formatDate(session.updated_at || session.submitted_at)}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/estimator/sessions/${session.id}`}
                        style={openButtonStyle}
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #d8e1ec",
        borderRadius: 18,
        padding: "20px 22px",
      }}
    >
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          color: "#2f6fed",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: "#627286", marginTop: 4 }}>{label}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 20px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "#7b8a9a",
  borderBottom: "1px solid #d8e1ec",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 20px",
  borderBottom: "1px solid #edf2f7",
  color: "#455468",
};

const tdStyleStrong: React.CSSProperties = {
  ...tdStyle,
  fontWeight: 600,
  color: "#18212b",
};

const statusBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  background: "#eaf1ff",
  color: "#2f6fed",
  border: "1px solid #cddcff",
};

const openButtonStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid #d8e1ec",
  background: "#ffffff",
  color: "#455468",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
};
function getStatusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  };

  if (status === "draft") {
    return {
      ...base,
      background: "#fff8e8",
      color: "#8a6417",
      border: "1px solid #f3e0a3",
    };
  }

  if (status === "reviewed") {
    return {
      ...base,
      background: "#edf8f2",
      color: "#1f9d55",
      border: "1px solid #cfe7d7",
    };
  }

  return {
    ...base,
    background: "#eaf1ff",
    color: "#2f6fed",
    border: "1px solid #cddcff",
  };
}

function getTierBadgeStyle(tier: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  };

  if (tier === "Bronze") {
    return {
      ...base,
      background: "#fdf1e5",
      color: "#a8611a",
      border: "1px solid #f1d3b2",
    };
  }

  if (tier === "Silver") {
    return {
      ...base,
      background: "#f1f5f9",
      color: "#475569",
      border: "1px solid #dbe3ec",
    };
  }

  if (tier === "Gold") {
    return {
      ...base,
      background: "#fff7db",
      color: "#9a6b00",
      border: "1px solid #f1dd8c",
    };
  }

  return {
    ...base,
    background: "#eaf1ff",
    color: "#2f6fed",
    border: "1px solid #cddcff",
  };
}