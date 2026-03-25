"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Screen = "loading" | "role" | "client" | "complete";

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

export default function EstimatorPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [companyName, setCompanyName] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
const [isSavingDraft, setIsSavingDraft] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setScreen("role");
    }, 600);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fetchQuestions = async () => {
      const { data, error } = await supabase
        .from("estimator_questions")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (error) {
        console.error("Error fetching questions:", error);
      } else {
        setQuestions(data || []);
      }
    };

    fetchQuestions();
  }, []);

  const groupedQuestions = questions.reduce<Record<string, Question[]>>(
    (acc, question) => {
      if (!acc[question.category]) {
        acc[question.category] = [];
      }
      acc[question.category].push(question);
      return acc;
    },
    {}
  );

  const calculateScore = () => {
    return questions.reduce((total, question) => {
      const answer = answers[String(question.id)];
      if (answer === question.trigger) {
        return total + question.weight;
      }
      return total;
    }, 0);
  };

  const calculateExpectedHours = () => {
    const baseHours = 24;
    return baseHours + calculateScore();
  };

  const getTier = () => {
    const hours = calculateExpectedHours();

    if (hours < 60) return "Bronze";
    if (hours < 110) return "Silver";
    if (hours < 180) return "Gold";
    return "Enterprise";
  };

  const getTimeline = () => {
    const tier = getTier();

    if (tier === "Bronze") return "3–5 weeks";
    if (tier === "Silver") return "5–8 weeks";
    if (tier === "Gold") return "8–12 weeks";
    return "12–16 weeks";
  };
const unansweredCount = questions.length - Object.keys(answers).length;

const flaggedQuestions = questions.filter((question) => {
  const answer = answers[String(question.id)];
  return answer === question.trigger && (question.blocker || question.sow);
});

const blockerCount = flaggedQuestions.filter((q) => q.blocker).length;
const sowCount = flaggedQuestions.filter((q) => q.sow).length;
const canSubmit =
  companyName.trim() &&
  primaryContact.trim() &&
  unansweredCount === 0;

const canSaveDraft = companyName.trim();
  const handleSaveDraft = async () => {
  if (!companyName.trim()) {
    alert("Please enter a company or prospect name.");
    return;
  }

  try {
    setIsSavingDraft(true);

    const { data, error } = await supabase
      .from("estimator_submissions")
      .insert({
        company_name: companyName,
        primary_contact: primaryContact,
        answers,
        estimated_hours: calculateExpectedHours(),
        tier: getTier(),
        timeline: getTimeline(),
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error saving draft:", error);
      alert("There was a problem saving the draft.");
      return;
    }

    if (data?.id) {
      window.location.href = `/estimator/sessions/${data.id}`;
    }
  } finally {
    setIsSavingDraft(false);
  }
};
const handleSubmit = async () => {
  try {
    setIsSubmitting(true);

    const { error } = await supabase.from("estimator_submissions").insert({
      company_name: companyName,
      primary_contact: primaryContact,
      answers,
      estimated_hours: calculateExpectedHours(),
      tier: getTier(),
      timeline: getTimeline(),
      status: "submitted",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Error saving submission:", error);
      alert("There was a problem saving the submission.");
      return;
    }

    setScreen("complete");
  } finally {
    setIsSubmitting(false);
  }
};

return (
    <div className="estimator-shell">
      {screen === "loading" && (
        <div className="loading-screen">
          <div className="spinner" />
          <div className="loading-text">Loading…</div>
        </div>
      )}

      {screen === "role" && (
        <div className="role-screen">
          <div className="role-title">
            AdFlo <span>Estimator</span>
          </div>
          <div className="role-subtitle">Select your role to continue</div>

          <div className="role-card-grid">
            <button
              className="role-card"
              onClick={() => setScreen("client")}
              type="button"
            >
              <div className="role-icon">📋</div>
              <div className="role-card-title">Client / Sales</div>
              <div className="role-card-text">
                Answer the onboarding questionnaire to help us understand your
                needs.
              </div>
            </button>

            <button
              className="role-card"
              onClick={() => alert("Team flow comes next.")}
              type="button"
            >
              <div className="role-icon">🔧</div>
              <div className="role-card-title">Implementation Team</div>
              <div className="role-card-text">
                View estimates, sessions, SRDs, history, and logic settings.
              </div>
            </button>
          </div>
        </div>
      )}

      {screen === "client" && (
        <div className="simple-screen">
          <h1>Implementation Questionnaire</h1>
          <p>Answer a few questions so we can estimate implementation scope.</p>
<div
  style={{
    maxWidth: 700,
    width: "100%",
    marginTop: 20,
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr 1fr",
  }}
>
  <input
    type="text"
    placeholder="Company / Prospect"
    value={companyName}
    onChange={(e) => setCompanyName(e.target.value)}
    style={{
      padding: "12px 14px",
      borderRadius: 12,
      border: "1px solid #d8e1ec",
      fontSize: 14,
    }}
  />
  <input
    type="text"
    placeholder="Primary Contact"
    value={primaryContact}
    onChange={(e) => setPrimaryContact(e.target.value)}
    style={{
      padding: "12px 14px",
      borderRadius: 12,
      border: "1px solid #d8e1ec",
      fontSize: 14,
    }}
  />
</div>
          <p style={{ marginBottom: 24, fontWeight: 600 }}>
  Estimated hours: {calculateExpectedHours()} · Tier: {getTier()} · Timeline: {getTimeline()}
</p>
{flaggedQuestions.length > 0 && (
  <div
    style={{
      marginBottom: 24,
      background: "#fff8e8",
      border: "1px solid #f3e0a3",
      borderRadius: 16,
      padding: 16,
      textAlign: "left",
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

    <div style={{ fontSize: 14, color: "#8a6417", marginBottom: 10 }}>
      {blockerCount} blocker{blockerCount !== 1 ? "s" : ""} · {sowCount} SOW item{sowCount !== 1 ? "s" : ""}
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      {flaggedQuestions.map((item) => (
        <div key={item.id} style={{ fontSize: 14, color: "#8a6417" }}>
          {item.blocker ? "Blocker" : "SOW"}: {item.question}
        </div>
      ))}
    </div>
  </div>
)}
          <div
            style={{
              maxWidth: 700,
              width: "100%",
              marginTop: 24,
              textAlign: "left",
            }}
          >
            {Object.entries(groupedQuestions).map(
              ([category, categoryQuestions]) => (
                <div key={category} style={{ marginBottom: 32 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#627286",
                      marginBottom: 12,
                    }}
                  >
                    {category}
                  </div>

                  {categoryQuestions.map((q) => (
                    <div
                      key={q.id}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #d8e1ec",
                        borderRadius: 14,
                        padding: 18,
                        marginBottom: 16,
                        boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          marginBottom: 12,
                          color: "#18212b",
                        }}
                      >
                        {q.question}
                      </div>

                      <div
                        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
                      >
                        {["Yes", "No"].map((opt) => {
                          const isSelected = answers[String(q.id)] === opt;

                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [String(q.id)]: opt,
                                }))
                              }
                              style={{
                                padding: "10px 14px",
                                borderRadius: 999,
                                border: isSelected
                                  ? "2px solid #2f6fed"
                                  : "1px solid #d8e1ec",
                                background: isSelected ? "#eaf1ff" : "#f8fafc",
                                color: isSelected ? "#2f6fed" : "#455468",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

<div style={{ marginTop: 12, marginBottom: 12, fontSize: 13, color: "#627286" }}>
  {!companyName.trim() && <div>Enter a company or prospect name to save a draft.</div>}
  {companyName.trim() && !primaryContact.trim() && (
    <div>Enter a primary contact before submitting.</div>
  )}
  {companyName.trim() && primaryContact.trim() && unansweredCount > 0 && (
    <div>Answer all remaining questions before submitting. {unansweredCount} left.</div>
  )}
  {canSubmit && <div style={{ color: "#1f9d55", fontWeight: 600 }}>Ready to submit.</div>}
</div>

         <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
  <button
    className="simple-button"
    onClick={handleSubmit}
    type="button"
    disabled={!canSubmit || isSubmitting}
    style={{
      opacity: !canSubmit || isSubmitting ? 0.5 : 1,
      cursor: !canSubmit || isSubmitting ? "not-allowed" : "pointer",
    }}
  >
    {isSubmitting ? "Submitting..." : "Submit"}
  </button>

  <button
    type="button"
    onClick={handleSaveDraft}
    disabled={!canSaveDraft || isSavingDraft}
    style={{
      padding: "12px 18px",
      borderRadius: 12,
      border: "1px solid #d8e1ec",
      background: "#ffffff",
      color: "#455468",
      fontWeight: 700,
      opacity: !canSaveDraft || isSavingDraft ? 0.5 : 1,
      cursor: !canSaveDraft || isSavingDraft ? "not-allowed" : "pointer",
    }}
  >
    {isSavingDraft ? "Saving Draft..." : "Save Draft"}
  </button>
</div>
        </div>
      )}

      {screen === "complete" && (
        <div className="simple-screen">
          <div className="role-icon">✅</div>
          <h1>All Done!</h1>
          <p>
            Thank you for completing the questionnaire. Our implementation team
            will review your answers and reach out with a tailored proposal
            soon.
          </p>
          <div className="tier-pill">
            ● {getTier()} Implementation · {calculateExpectedHours()} hrs ·{" "}
            {getTimeline()}
          </div>
          {flaggedQuestions.length > 0 && (
  <div
    style={{
      marginTop: 16,
      background: "#fff8e8",
      border: "1px solid #f3e0a3",
      borderRadius: 16,
      padding: 16,
      textAlign: "left",
      maxWidth: 640,
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

    <div style={{ fontSize: 14, color: "#8a6417", marginBottom: 10 }}>
      {blockerCount} blocker{blockerCount !== 1 ? "s" : ""} · {sowCount} SOW item{sowCount !== 1 ? "s" : ""}
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      {flaggedQuestions.map((item) => (
        <div key={item.id} style={{ fontSize: 14, color: "#8a6417" }}>
          {item.blocker ? "Blocker" : "SOW"}: {item.question}
        </div>
      ))}
    </div>
  </div>
)}
          <button
            className="simple-button secondary"
            onClick={() => setScreen("client")}
            type="button"
          >
            ← Edit Answers
          </button>
        </div>
      )}
    </div>
  );
}