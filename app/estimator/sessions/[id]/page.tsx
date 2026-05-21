"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProjectTab from "./ProjectTab";

type SessionRow = {
  id: string;
  company_name: string | null;
  primary_contact: string | null;
  answers: Record<string, string>;
  estimated_hours: number;
  tier: string;
  timeline: string | null;
  submitted_at: string;
  intake_notes: Record<string, string> | null;
};

type Question = {
  id: number;
  category: string;
  question: string;
  trigger: string;
  weight: number;
  can_remove: boolean;
  blocker: boolean;
  sow: boolean;
  is_active: boolean;
  display_order: number;
};

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const [session, setSession] = useState<SessionRow | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editLinkCopied, setEditLinkCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"session" | "project">("session");

  async function copyEditLink() {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/estimator/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        navigator.clipboard.writeText(data.url).catch(() => prompt("Copy this link:", data.url));
        setEditLinkCopied(true);
        setTimeout(() => setEditLinkCopied(false), 2000);
      }
    } catch {
      console.error("Failed to generate edit link");
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      if (!sessionId) return;

      try {
        const [sessionRes, questionsRes] = await Promise.all([
          fetch(`/api/estimator/sessions/${sessionId}`),
          fetch("/api/estimator/questions"),
        ]);

        if (sessionRes.ok) {
          setSession(await sessionRes.json() as SessionRow);
        } else {
          console.error("Error fetching session:", await sessionRes.text());
        }

        if (questionsRes.ok) {
          setQuestions(await questionsRes.json() as Question[]);
        } else {
          console.error("Error fetching questions:", await questionsRes.text());
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionId]);

  const grouped = useMemo(() => {
    const answers = session?.answers || {};
    const groups: Record<
      string,
      Array<{
        id: number;
        question: string;
        answer: string;
        trigger: string;
        weight: number;
        blocker: boolean;
        sow: boolean;
        isTriggered: boolean;
      }>
    > = {};

    for (const q of questions) {
      const answer = answers[String(q.id)] || "—";
      const isTriggered = answer === q.trigger;

      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category].push({
        id: q.id,
        question: q.question,
        answer,
        trigger: q.trigger,
        weight: q.weight,
        blocker: q.blocker,
        sow: q.sow,
        isTriggered,
      });
    }

    return groups;
  }, [questions, session]);

const blockers = useMemo(() => {
  const answers = session?.answers || {};
  return questions.filter((q) => {
    const answer = answers[String(q.id)];
    return answer === q.trigger && q.blocker;
  });
}, [questions, session]);

const sowItems = useMemo(() => {
  const answers = session?.answers || {};
  return questions.filter((q) => {
    const answer = answers[String(q.id)];
    return answer === q.trigger && q.sow;
  });
}, [questions, session]);

  if (loading) {
    return <div style={{ padding: 32 }}>Loading session...</div>;
  }

  if (!session) {
    return (
      <div style={{ padding: 32 }}>
        <h1>Session not found</h1>
        <div style={{ marginTop: 16 }}>
          <Link href="/estimator/sessions">← Back to Sessions</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link href="/estimator/sessions" style={{ color: "#627286", textDecoration: "none" }}>
              ← Back to Sessions
            </Link>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>
            {session.company_name || "Untitled Session"}
          </h1>
          <p style={{ marginTop: 6, color: "#627286", margin: "6px 0 0", fontSize: 14 }}>
            Contact: {session.primary_contact || "—"}
          </p>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #d8e1ec", borderRadius: 16, padding: "14px 18px", minWidth: 260 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <SummaryRow label="Estimated Hours" value={`${session.estimated_hours} hrs`} />
            <SummaryRow label="Tier" value={session.tier} />
            <SummaryRow label="Blockers" value={String(blockers.length)} />
            <SummaryRow label="SOW Items" value={String(sowItems.length)} />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={`/estimator/edit/${session.id}`}
          style={{ display: "inline-block", padding: "9px 16px", borderRadius: 12, border: "1px solid #d8e1ec", background: "#ffffff", color: "#455468", fontWeight: 600, textDecoration: "none", fontSize: 13.5 }}
        >
          Continue Editing →
        </Link>
        {session.intake_notes && (
          <button
            type="button"
            onClick={copyEditLink}
            style={{
              padding: "9px 16px", borderRadius: 12,
              border: editLinkCopied ? "1px solid #c0e8d0" : "1px solid #d8e1ec",
              background: editLinkCopied ? "#edf8f2" : "#ffffff",
              color: editLinkCopied ? "#1f9d55" : "#455468",
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
            }}
          >
            {editLinkCopied ? "✓ Link Copied!" : "🔗 Copy Edit Link"}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, borderBottom: "2px solid #edf2f7", marginBottom: 24 }}>
        {(["session", "project"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 20px",
              border: "none",
              background: "transparent",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? "#2f6fed" : "#627286",
              borderBottom: `2px solid ${activeTab === tab ? "#2f6fed" : "transparent"}`,
              marginBottom: -2,
              cursor: "pointer",
              transition: "color 0.15s",
              textTransform: "capitalize",
            }}
          >
            {tab === "session" ? "Session Details" : "Project Tracker"}
          </button>
        ))}
      </div>

      {/* Project tab */}
      {activeTab === "project" && (
        <ProjectTab sessionId={session.id} estimatedHours={session.estimated_hours} />
      )}

      {/* Session details tab */}
      {activeTab === "session" && (<>

      {(blockers.length > 0 || sowItems.length > 0) && (
  <div
    style={{
      marginBottom: 24,
      background: "#fff8e8",
      border: "1px solid #f3e0a3",
      borderRadius: 16,
      padding: 16,
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "#8a6417",
        marginBottom: 10,
      }}
    >
      Scope Flags
    </div>

    <div style={{ fontSize: 14, color: "#8a6417", marginBottom: 12 }}>
      {blockers.length} blocker{blockers.length !== 1 ? "s" : ""} · {sowItems.length} SOW item{sowItems.length !== 1 ? "s" : ""}
    </div>

    {blockers.length > 0 && (
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#8a6417",
            marginBottom: 8,
          }}
        >
          Blockers
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {blockers.map((item) => (
            <div key={item.id} style={{ fontSize: 14, color: "#8a6417" }}>
              {item.question}
            </div>
          ))}
        </div>
      </div>
    )}

    {sowItems.length > 0 && (
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#8a6417",
            marginBottom: 8,
          }}
        >
          SOW Items
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {sowItems.map((item) => (
            <div key={item.id} style={{ fontSize: 14, color: "#8a6417" }}>
              {item.question}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
      <div style={{ display: "grid", gap: 24 }}>
        {Object.entries(grouped).map(([category, items]) => (
          <div
            key={category}
            style={{
              background: "#ffffff",
              border: "1px solid #d8e1ec",
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #d8e1ec",
                background: "#f8fafc",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#627286",
              }}
            >
              {category}
            </div>

            <div style={{ padding: 20, display: "grid", gap: 14 }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid #e5ebf3",
                    borderRadius: 14,
                    padding: 16,
                    background: item.isTriggered ? "#eaf1ff" : "#ffffff",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#18212b", marginBottom: 8 }}>
                    {item.question}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={answerPillStyle(item.answer === "Yes")}>Yes</span>
                    <span style={answerPillStyle(item.answer === "No")}>No</span>
                    <span style={{ fontSize: 12, color: "#627286", marginLeft: 4 }}>
                      Selected: {item.answer}
                    </span>
                  </div>

                  {item.isTriggered && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#2f6fed", fontWeight: 700 }}>
                      Triggered
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      </>)}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#627286", fontSize: 14 }}>{label}</span>
      <span style={{ color: "#18212b", fontSize: 14, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function answerPillStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "2px solid #2f6fed" : "1px solid #d8e1ec",
    background: active ? "#eaf1ff" : "#f8fafc",
    color: active ? "#2f6fed" : "#455468",
    fontWeight: 700,
    fontSize: 13,
  };
}