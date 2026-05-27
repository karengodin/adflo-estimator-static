"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type ConditionalLogic = {
  type: "any_answered_yes_or_nonzero" | "greater_than";
  sort_orders?: number[];
  sort_order?: number;
  value?: number;
} | null;

type PublicQuestion = {
  id: number;
  category: string;
  question: string;
  trigger: string;
  sort_order: number;
  question_type: "yesno" | "number" | "date";
  conditional_logic: ConditionalLogic;
};

type PublicData = {
  sessionId: string;
  companyName: string | null;
  answers: Record<string, string>;
  questions: PublicQuestion[];
};

// ─── Conditional visibility (mirrors internal estimator logic) ────────────────

function isVisible(
  q: PublicQuestion,
  allQuestions: PublicQuestion[],
  answers: Record<string, string>
): boolean {
  if (!q.conditional_logic) return true;
  const logic = q.conditional_logic;

  const bySort = (n: number) => allQuestions.find((x) => x.sort_order === n);
  const yesOrNonzero = (dep: PublicQuestion | undefined) => {
    if (!dep) return false;
    const a = answers[String(dep.id)] ?? "";
    if (dep.question_type === "number") return parseInt(a || "0", 10) > 0;
    return a === "Yes";
  };

  if (logic.type === "any_answered_yes_or_nonzero") {
    return (logic.sort_orders ?? []).some((so) => yesOrNonzero(bySort(so)));
  }
  if (logic.type === "greater_than") {
    const dep = bySort(logic.sort_order!);
    if (!dep) return false;
    return parseInt(answers[String(dep.id)] || "0", 10) > (logic.value ?? 0);
  }
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicQuestionnairePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [data, setData] = useState<PublicData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const res = await fetch(`/api/estimator/share?token=${token}`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || "This link is invalid or has expired.");
          return;
        }
        const d = await res.json() as PublicData;
        setData(d);
        setAnswers(d.answers || {});
      } catch {
        setError("Failed to load the questionnaire. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const allQuestions = data?.questions ?? [];

  const visibleQuestions = allQuestions.filter((q) => isVisible(q, allQuestions, answers));
  const categories = [...new Set(visibleQuestions.map((q) => q.category))];

  const isAnswered = (q: PublicQuestion) => {
    const a = answers[String(q.id)];
    return a !== undefined && a !== "";
  };
  const answeredCount = visibleQuestions.filter(isAnswered).length;
  const totalCount = visibleQuestions.length;
  const allVisibleAnswered = totalCount > 0 && answeredCount === totalCount;

  const autosave = (updatedAnswers: Record<string, string>) => {
    if (!token) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/estimator/share?token=${token}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: updatedAnswers }),
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 2500);
      } catch {
        setSaveStatus("");
      }
    }, 800);
  };

  const handleAnswer = (questionId: number, value: string) => {
    const updated = { ...answers, [String(questionId)]: value };
    setAnswers(updated);
    autosave(updated);
  };

  const handleSubmit = async () => {
    if (!token || !allVisibleAnswered) return;
    setSubmitting(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await fetch(`/api/estimator/share?token=${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, status: "submitted" }),
      });
      setSubmitted(true);
    } catch {
      setSubmitting(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={fullPageCenter}>
        <div style={spinnerStyle} />
        <div style={{ marginTop: 16, color: "#627286", fontSize: 14 }}>Loading your questionnaire…</div>
      </div>
    );
  }

  // ── Error / expired state ──────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ ...fullPageCenter, padding: 24 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f1623", marginBottom: 12, letterSpacing: "-0.02em" }}>
            Link Unavailable
          </h2>
          <p style={{ fontSize: 14, color: "#627286", lineHeight: 1.75, margin: "0 0 20px" }}>
            {error.includes("expired")
              ? "This link has expired. Please contact your AdFlo representative for a new link."
              : "This link is invalid or no longer active. Please contact your AdFlo representative."}
          </p>
          <div style={{ fontSize: 13, color: "#8a9bb0" }}>
            Questions? Email{" "}
            <a href="mailto:support@tapclicks.com" style={{ color: "#2f6fed", textDecoration: "none" }}>
              support@tapclicks.com
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted confirmation ─────────────────────────────────────────────────

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f9 0%, #eef2f7 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 24 }}>
        <div style={{ ...cardStyle, maxWidth: 520 }}>
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: "linear-gradient(135deg, #2f6fed, #4fbf9f)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 28, color: "#fff", fontWeight: 700 }}>
            ✓
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623", marginBottom: 12 }}>
            Thank You!
          </h2>
          <p style={{ fontSize: 15, color: "#627286", lineHeight: 1.75, margin: "0 0 8px" }}>
            Your answers have been submitted{data?.companyName ? ` for ${data.companyName}` : ""}.
          </p>
          <p style={{ fontSize: 14, color: "#8a9bb0", lineHeight: 1.75, margin: 0 }}>
            Your AdFlo implementation team will review your responses and be in touch shortly with next steps.
          </p>
        </div>
      </div>
    );
  }

  // ── Main questionnaire ─────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f5f8fc 0%, #eef2f8 100%)", fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <header style={{ background: "#0f1623", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #2f6fed, #4fbf9f)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
            af
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>AdFlo</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", margin: "0 2px" }}>·</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Implementation Questionnaire</span>
        </div>
        <span style={{ fontSize: 12, color: saveStatus === "saved" ? "#4fbf9f" : "rgba(255,255,255,0.4)", minWidth: 60, textAlign: "right", transition: "color 0.2s" }}>
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : ""}
        </span>
      </header>

      {/* Intro + progress */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde5ef" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px 20px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623", marginBottom: 6 }}>
            {data?.companyName ? `${data.companyName} — ` : ""}Implementation Questionnaire
          </h1>
          <p style={{ fontSize: 13.5, color: "#627286", lineHeight: 1.7, marginBottom: 16, maxWidth: 560 }}>
            Help us understand your needs by answering these questions. Your answers help us accurately estimate your implementation timeline and configure everything correctly for you.
          </p>
          {/* Progress bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0}%`,
                background: "linear-gradient(90deg, #2f6fed, #4fbf9f)",
                borderRadius: 999,
                transition: "width 0.4s",
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#627286", whiteSpace: "nowrap" }}>
              {answeredCount} / {totalCount} answered
            </span>
          </div>
        </div>
      </div>

      {/* Questions grouped by category */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "28px 20px 96px" }}>
        {categories.map((cat) => (
          <section key={cat} style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12, paddingLeft: 2 }}>
              {cat}
            </div>
            {visibleQuestions.filter((q) => q.category === cat).map((q) => {
              const a = answers[String(q.id)] ?? "";
              const answered = a !== "";
              return (
                <div key={q.id} style={{
                  background: "#fff",
                  border: `1.5px solid ${answered ? "#cddcff" : "#dde5ef"}`,
                  borderRadius: 16,
                  padding: "18px 20px",
                  marginBottom: 10,
                  boxShadow: answered ? "0 2px 8px rgba(47,111,237,0.06)" : "0 1px 3px rgba(16,24,40,0.04)",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}>
                  <div style={{ fontSize: 14.5, color: "#0f1623", lineHeight: 1.65, fontWeight: 500, marginBottom: 14 }}>
                    {q.question}
                  </div>

                  {/* Yes/No */}
                  {q.question_type === "yesno" && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(["Yes", "No"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleAnswer(q.id, opt)}
                          style={{
                            padding: "9px 24px",
                            borderRadius: 999,
                            fontSize: 13.5,
                            fontWeight: 700,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "all 0.15s",
                            border: a === opt
                              ? (opt === "Yes" ? "2px solid #1f9d55" : "2px solid #dc2626")
                              : "1.5px solid #dde5ef",
                            background: a === opt
                              ? (opt === "Yes" ? "#1f9d55" : "#dc2626")
                              : "#f8fafc",
                            color: a === opt ? "#fff" : "#627286",
                          }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Number */}
                  {q.question_type === "number" && (
                    <input
                      type="number"
                      min={0}
                      value={a}
                      placeholder="Enter a number"
                      onChange={(e) => handleAnswer(q.id, e.target.value)}
                      style={{
                        width: "100%",
                        maxWidth: 200,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1.5px solid ${answered ? "#2f6fed" : "#dde5ef"}`,
                        fontSize: 15,
                        fontFamily: "inherit",
                        color: "#0f1623",
                        background: "#f8fafc",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  )}

                  {/* Date */}
                  {q.question_type === "date" && (
                    <input
                      type="date"
                      value={a}
                      onChange={(e) => handleAnswer(q.id, e.target.value)}
                      style={{
                        width: "100%",
                        maxWidth: 240,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1.5px solid ${answered ? "#2f6fed" : "#dde5ef"}`,
                        fontSize: 15,
                        fontFamily: "inherit",
                        color: "#0f1623",
                        background: "#f8fafc",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </section>
        ))}

        {/* Submit */}
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          {!allVisibleAnswered && (
            <div style={{ fontSize: 13, color: "#8a9bb0" }}>
              {totalCount - answeredCount} question{totalCount - answeredCount !== 1 ? "s" : ""} remaining before you can submit
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={!allVisibleAnswered || submitting}
            style={{
              padding: "13px 32px",
              borderRadius: 12,
              border: "none",
              fontFamily: "inherit",
              fontWeight: 700,
              fontSize: 15,
              cursor: allVisibleAnswered && !submitting ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              background: allVisibleAnswered && !submitting ? "linear-gradient(135deg, #2f6fed, #1a55cc)" : "#c8d4e0",
              color: "#fff",
              boxShadow: allVisibleAnswered && !submitting ? "0 4px 14px rgba(47,111,237,0.35)" : "none",
            }}>
            {submitting ? "Submitting…" : "Submit Questionnaire →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const fullPageCenter: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #f0f4f9 0%, #eef2f7 100%)",
  fontFamily: "'DM Sans', sans-serif",
};

const cardStyle: React.CSSProperties = {
  maxWidth: 480,
  width: "100%",
  background: "#fff",
  border: "1px solid #dde5ef",
  borderRadius: 24,
  padding: "44px 40px",
  textAlign: "center",
  boxShadow: "0 2px 20px rgba(16,24,40,0.08)",
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "3px solid #dde5ef",
  borderTopColor: "#2f6fed",
  borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
  margin: "0 auto",
};
