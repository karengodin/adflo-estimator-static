"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type SessionRow = {
  id: string;
  company_name: string | null;
  primary_contact: string | null;
  answers: Record<string, string>;
  estimated_hours: number;
  tier: string;
  timeline: string | null;
  submitted_at: string;
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

  useEffect(() => {
    const fetchData = async () => {
      if (!sessionId) return;

      const [{ data: sessionData, error: sessionError }, { data: questionData, error: questionError }] =
        await Promise.all([
          supabase
            .from("estimator_submissions")
            .select("*")
            .eq("id", sessionId)
            .single(),
          supabase
            .from("estimator_questions")
            .select("*")
            .eq("is_active", true)
            .order("display_order", { ascending: true }),
        ]);

      if (sessionError) {
        console.error("Error fetching session:", sessionError);
      } else {
        setSession(sessionData as SessionRow);
      }

      if (questionError) {
        console.error("Error fetching questions:", questionError);
      } else {
        setQuestions((questionData as Question[]) || []);
      }

      setLoading(false);
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
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link href="/estimator/sessions" style={{ color: "#627286", textDecoration: "none" }}>
              ← Back to Sessions
            </Link>
          </div>
          <h1 style={{ margin: 0, fontSize: 32 }}>
            {session.company_name || "Untitled Session"}
          </h1>
          <p style={{ marginTop: 8, color: "#627286" }}>
            Primary Contact: {session.primary_contact || "—"}
          </p>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #d8e1ec",
            borderRadius: 16,
            padding: 16,
            minWidth: 280,
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <SummaryRow label="Estimated Hours" value={`${session.estimated_hours} hrs`} />
            <SummaryRow label="Tier" value={session.tier} />
            <SummaryRow label="Timeline" value={session.timeline || "—"} />
            <SummaryRow label="Blockers" value={String(blockers.length)} />
			<SummaryRow label="SOW Items" value={String(sowItems.length)} />
            <SummaryRow label="Submitted" value={new Date(session.submitted_at).toLocaleString()} />
          </div>
        </div>
      </div>
<div style={{ marginTop: 16 }}>
  <Link
    href={`/estimator/edit/${session.id}`}
    style={{
      display: "inline-block",
      padding: "10px 16px",
      borderRadius: 12,
      border: "1px solid #d8e1ec",
      background: "#ffffff",
      color: "#455468",
      fontWeight: 600,
      textDecoration: "none",
    }}
  >
    Continue Editing →
  </Link>
</div>

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