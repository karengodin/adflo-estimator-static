"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

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

export default function EditEstimatorSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params?.id;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [companyName, setCompanyName] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
const [isSubmittingSession, setIsSubmittingSession] = useState(false);

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
      } else if (sessionData) {
        const session = sessionData as SessionRow;
        setCompanyName(session.company_name || "");
        setPrimaryContact(session.primary_contact || "");
        setAnswers(session.answers || {});
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

  const groupedQuestions = useMemo(() => {
    return questions.reduce<Record<string, Question[]>>((acc, question) => {
      if (!acc[question.category]) acc[question.category] = [];
      acc[question.category].push(question);
      return acc;
    }, {});
  }, [questions]);

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
    return 24 + calculateScore();
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

  const handleSave = async () => {
    if (!companyName.trim()) {
      alert("Please enter a company or prospect name.");
      return;
    }

    if (!primaryContact.trim()) {
      alert("Please enter a primary contact.");
      return;
    }

    if (!sessionId) return;

    try {
      setIsSaving(true);

      const { error } = await supabase
        .from("estimator_submissions")
        .update({
          company_name: companyName,
          primary_contact: primaryContact,
          answers,
          estimated_hours: calculateExpectedHours(),
          tier: getTier(),
          timeline: getTimeline(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (error) {
        console.error("Error updating session:", error);
        alert("There was a problem saving the session.");
        return;
      }

      router.push(`/estimator/sessions/${sessionId}`);
    } finally {
      setIsSaving(false);
    }
  };
const handleSubmitSession = async () => {
  if (!companyName.trim()) {
    alert("Please enter a company or prospect name.");
    return;
  }

  if (!primaryContact.trim()) {
    alert("Please enter a primary contact.");
    return;
  }

  if (Object.keys(answers).length < questions.length) {
    alert(
      `Please answer all questions before submitting. ${
        questions.length - Object.keys(answers).length
      } remaining.`
    );
    return;
  }

  if (!sessionId) return;

  try {
    setIsSubmittingSession(true);

    const { error } = await supabase
      .from("estimator_submissions")
      .update({
        company_name: companyName,
        primary_contact: primaryContact,
        answers,
        estimated_hours: calculateExpectedHours(),
        tier: getTier(),
        timeline: getTimeline(),
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error) {
      console.error("Error submitting session:", error);
      alert("There was a problem submitting the session.");
      return;
    }

    router.push(`/estimator/sessions/${sessionId}`);
  } finally {
    setIsSubmittingSession(false);
  }
};

  if (loading) {
    return <div style={{ padding: 32 }}>Loading session...</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <Link href={`/estimator/sessions/${sessionId}`} style={{ color: "#627286", textDecoration: "none" }}>
          ← Back to Session
        </Link>
        <h1 style={{ marginTop: 12, marginBottom: 8 }}>Continue Editing</h1>
        <p style={{ color: "#627286" }}>
          Update answers and save changes back to this session.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 20,
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

      <div style={{ display: "grid", gap: 24 }}>
        {Object.entries(groupedQuestions).map(([category, categoryQuestions]) => (
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
              {categoryQuestions.map((q) => (
                <div
                  key={q.id}
                  style={{
                    border: "1px solid #e5ebf3",
                    borderRadius: 14,
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#18212b", marginBottom: 12 }}>
                    {q.question}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                            border: isSelected ? "2px solid #2f6fed" : "1px solid #d8e1ec",
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
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: "none",
            background: "#2f6fed",
            color: "#ffffff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>

        <Link
          href={`/estimator/sessions/${sessionId}`}
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: "1px solid #d8e1ec",
            background: "#ffffff",
            color: "#455468",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}