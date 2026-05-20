"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type PublicQuestion = {
  id: number;
  category: string;
  question: string;
  trigger: string;
};

type PublicData = {
  sessionId: string;
  companyName: string | null;
  answers: Record<string, string>;
  questions: PublicQuestion[];
};

export default function PublicQuestionnairePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [data, setData] = useState<PublicData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
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

  const categories = data ? [...new Set(data.questions.map((q) => q.category))] : [];
  const answeredCount = Object.keys(answers).length;
  const totalCount = data?.questions.length ?? 0;
  const allAnswered = totalCount > 0 && answeredCount >= totalCount;

  const saveAnswers = async (updatedAnswers: Record<string, string>, status?: string) => {
    if (!token) return;
    setSaveStatus("saving");
    try {
      await fetch(`/api/estimator/share?token=${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: updatedAnswers, ...(status ? { status } : {}) }),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2500);
    } catch {
      setSaveStatus("");
    }
  };

  const handleAnswer = (questionId: number, value: string) => {
    const updated = { ...answers, [String(questionId)]: value };
    setAnswers(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveAnswers(updated), 800);
  };

  const handleSubmit = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveAnswers(answers, "submitted");
    setSubmitted(true);
  };

  if (loading) {
    return (
      <div style={fullPageCenter}>
        <div style={spinnerStyle} />
        <div style={{ marginTop: 16, color: "#627286", fontSize: 14 }}>Loading your questionnaire…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...fullPageCenter, padding: 24 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 42, marginBottom: 20 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0f1623", marginBottom: 12 }}>Link Unavailable</h2>
          <p style={{ fontSize: 14, color: "#627286", lineHeight: 1.7, margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ ...fullPageCenter, background: "linear-gradient(135deg, #f0f4f9 0%, #eef2f7 100%)", padding: 24 }}>
        <div style={cardStyle}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #2f6fed, #4fbf9f)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 26, color: "#fff", fontWeight: 700 }}>✓</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f1623", marginBottom: 14 }}>Thank You!</h2>
          <p style={{ fontSize: 15, color: "#627286", lineHeight: 1.75, margin: 0 }}>
            We've received your responses{data?.companyName ? ` for ${data.companyName}` : ""}.
            Our implementation team will review your answers and reach out with next steps soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f5f8fc 0%, #eef2f8 100%)", fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <header style={{ background: "#0f1623", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #2f6fed, #4fbf9f)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>af</div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>AdFlo</span>
        </div>
        {saveStatus && (
          <span style={{ fontSize: 12, color: saveStatus === "saved" ? "#4fbf9f" : "rgba(255,255,255,0.45)" }}>
            {saveStatus === "saving" ? "Saving…" : "✓ Saved"}
          </span>
        )}
      </header>

      {/* Intro bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #dde5ef" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 28px 24px" }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623", marginBottom: 8 }}>
            Implementation Questionnaire
            {data?.companyName && <span style={{ color: "#8a9bb0", fontWeight: 500, fontSize: 20 }}> — {data.companyName}</span>}
          </h1>
          <p style={{ fontSize: 14, color: "#627286", lineHeight: 1.7, marginBottom: 18 }}>
            Help us understand your current setup. This takes about 5 minutes and ensures we configure everything correctly for you.
          </p>
          {/* Progress */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${totalCount > 0 ? (answeredCount / totalCount) * 100 : 0}%`, background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", borderRadius: 999, transition: "width 0.35s" }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#627286", whiteSpace: "nowrap" }}>
              {answeredCount} / {totalCount}
            </span>
          </div>
        </div>
      </div>

      {/* Questions */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 28px 72px" }}>
        {categories.map((cat) => (
          <div key={cat} style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>{cat}</div>
            {(data?.questions ?? []).filter((q) => q.category === cat).map((q) => {
              const a = answers[String(q.id)];
              return (
                <div key={q.id} style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: "18px 20px", marginBottom: 10, boxShadow: "0 1px 3px rgba(16,24,40,0.04)", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 20 }}>
                  <div style={{ fontSize: 14, color: "#0f1623", lineHeight: 1.6, fontWeight: 500 }}>{q.question}</div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {["Yes", "No"].map((opt) => (
                      <button key={opt} type="button" onClick={() => handleAnswer(q.id, opt)}
                        style={{ padding: "9px 20px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                          border: a === opt ? (opt === "Yes" ? "2px solid #1f9d55" : "2px solid #dc2626") : "1.5px solid #dde5ef",
                          background: a === opt ? (opt === "Yes" ? "#1f9d55" : "#dc2626") : "#f8fafc",
                          color: a === opt ? "#fff" : "#627286",
                        }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Submit */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={handleSubmit} disabled={!allAnswered}
            style={{ padding: "13px 28px", borderRadius: 12, border: "none", fontFamily: "inherit", fontWeight: 700, fontSize: 14, cursor: allAnswered ? "pointer" : "not-allowed", transition: "all 0.2s",
              background: allAnswered ? "#2f6fed" : "#c8d4e0",
              color: "#fff",
            }}>
            Submit Responses →
          </button>
          {!allAnswered && (
            <span style={{ fontSize: 13, color: "#8a9bb0" }}>
              {totalCount - answeredCount} question{totalCount - answeredCount !== 1 ? "s" : ""} remaining
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

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
  padding: "48px 44px",
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
