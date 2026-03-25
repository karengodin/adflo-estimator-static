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

  // =========================
  // DERIVED QUESTION GROUPING
  // =========================
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

  // =========================
  // ESTIMATOR CALCULATIONS
  // =========================
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

  // =========================
  // SUBMISSION STATE
  // =========================
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

  // =========================
  // SHARED UI STYLES
  // =========================
  const metricBox: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #d8e1ec",
    borderRadius: 14,
    padding: 16,
    fontWeight: 700,
    textAlign: "center",
  };

  // =========================
  // ACTIONS
  // =========================
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
      {/* =========================
          LOADING SCREEN
      ========================= */}
      {screen === "loading" && (
        <div className="loading-screen">
          <div className="spinner" />
          <div className="loading-text">Loading…</div>
        </div>
      )}

      {/* =========================
          ROLE SELECTION SCREEN
      ========================= */}
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

      {/* =========================
          CLIENT / SALES SCREEN
      ========================= */}
      {screen === "client" && (
        <div style={{ background: "#f5f7fb", minHeight: "100vh" }}>
          {/* =========================
              TOP HEADER BAR
          ========================= */}
          <div
            style={{
              width: "100%",
              padding: "16px 24px",
              borderBottom: "1px solid #e6edf5",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#ffffff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                adflo <span style={{ color: "#2f6fed" }}>estimator</span>
              </div>

              <div
                style={{
                  background: "#e6f4ea",
                  color: "#1f9d55",
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ● Client / Sales
              </div>
            </div>

            <button
              onClick={() => setScreen("role")}
              style={{
                border: "1px solid #d8e1ec",
                borderRadius: 10,
                padding: "8px 12px",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Switch Role
            </button>
          </div>

          {/* =========================
              CENTERED PAGE CONTENT
          ========================= */}
          <div
            style={{
              maxWidth: 760,
              margin: "0 auto",
              padding: "32px 20px 60px",
              textAlign: "center",
            }}
          >
            {/* =========================
                PAGE TITLE
            ========================= */}
            <h1 style={{ marginBottom: 8, color: "#18212b" }}>
              Implementation Questionnaire
            </h1>
            <p style={{ color: "#627286", marginBottom: 0 }}>
              Answer a few questions so we can estimate implementation scope.
            </p>

            {/* =========================
                COMPANY / CONTACT CARD
            ========================= */}
            <div
              style={{
                marginTop: 20,
                background: "#ffffff",
                border: "1px solid #d8e1ec",
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div
                style={{
                  width: "100%",
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
            </div>

            {/* =========================
                LIVE METRICS SUMMARY
            ========================= */}
            <div
              style={{
                marginTop: 20,
                marginBottom: 24,
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <div style={metricBox}>{calculateExpectedHours()} hrs</div>
              <div style={metricBox}>{getTier()}</div>
              <div style={metricBox}>{getTimeline()}</div>
            </div>

            {/* =========================
                QUESTION LIST
            ========================= */}
            <div
              style={{
                width: "100%",
                marginTop: 24,
                textAlign: "left",
              }}
            >
              {Object.entries(groupedQuestions).map(
                ([category, categoryQuestions]) => (
                  <div key={category} style={{ marginBottom: 28 }}>
                    {/* CATEGORY LABEL */}
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

                    {/* QUESTION CARDS */}
                    {categoryQuestions.map((q) => {
                      const isTriggered = answers[String(q.id)] === q.trigger;

                      return (
                        <div
                          key={q.id}
                          style={{
                            background: isTriggered ? "#eaf1ff" : "#ffffff",
                            border: isTriggered
                              ? "1px solid #cddcff"
                              : "1px solid #d8e1ec",
                            borderRadius: 14,
                            padding: 16,
                            marginBottom: 12,
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
                                    border: "1px solid #d8e1ec",
                                    background: isSelected
                                      ? opt === "Yes"
                                        ? "#1f9d55"
                                        : "#d64545"
                                      : "#f8fafc",
                                    color: isSelected ? "#ffffff" : "#455468",
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
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* =========================
                HELPER / VALIDATION TEXT
            ========================= */}
            <div
              style={{
                marginTop: 12,
                marginBottom: 12,
                fontSize: 13,
                color: "#627286",
              }}
            >
              {!companyName.trim() && (
                <div>Enter a company or prospect name to save a draft.</div>
              )}
              {companyName.trim() && !primaryContact.trim() && (
                <div>Enter a primary contact before submitting.</div>
              )}
              {companyName.trim() &&
                primaryContact.trim() &&
                unansweredCount > 0 && (
                  <div>
                    Answer all remaining questions before submitting.{" "}
                    {unansweredCount} left.
                  </div>
                )}
              {canSubmit && (
                <div style={{ color: "#1f9d55", fontWeight: 600 }}>
                  Ready to submit.
                </div>
              )}
            </div>

            {/* =========================
                ACTION BUTTONS
            ========================= */}
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 12,
                justifyContent: "center",
              }}
            >
              <button
                className="simple-button"
                onClick={handleSubmit}
                type="button"
                disabled={!canSubmit || isSubmitting}
                style={{
                  opacity: !canSubmit || isSubmitting ? 0.5 : 1,
                  cursor:
                    !canSubmit || isSubmitting ? "not-allowed" : "pointer",
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
                  cursor:
                    !canSaveDraft || isSavingDraft
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {isSavingDraft ? "Saving Draft..." : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          COMPLETION SCREEN
      ========================= */}
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

          {/* Keeping this here for now since it helps after submission */}
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

              <div
                style={{ fontSize: 14, color: "#8a6417", marginBottom: 10 }}
              >
                {blockerCount} blocker{blockerCount !== 1 ? "s" : ""} ·{" "}
                {sowCount} SOW item{sowCount !== 1 ? "s" : ""}
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