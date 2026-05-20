"use client";

import { useEffect, useState } from "react";

type Question = {
  id: number;
  category: string;
  question: string;
  trigger: string;
  weight: number;
  question_type: "yesno" | "number" | "date";
  conditional_logic: {
    type: "any_answered_yes_or_nonzero" | "greater_than";
    sort_orders?: number[];
    sort_order?: number;
    value?: number;
  } | null;
  display_order: number;
  is_active: boolean;
};

function isVisible(q: Question, all: Question[], answers: Record<string, string>): boolean {
  const cl = q.conditional_logic;
  if (!cl) return true;
  const bySort = (n: number) => all.find((x) => x.display_order === n);
  const isYesOrNonzero = (dep: Question) => {
    const a = answers[String(dep.id)];
    if (dep.question_type === "number") return parseInt(a || "0", 10) > 0;
    return a === "Yes";
  };
  if (cl.type === "any_answered_yes_or_nonzero") {
    return (cl.sort_orders ?? []).some((so) => { const dep = bySort(so); return dep ? isYesOrNonzero(dep) : false; });
  }
  if (cl.type === "greater_than") {
    const dep = bySort(cl.sort_order!);
    if (!dep) return false;
    return (parseInt(answers[String(dep.id)] || "0", 10) || 0) > (cl.value ?? 0);
  }
  return true;
}

export default function IntakePage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQs, setLoadingQs] = useState(true);

  const [companyName, setCompanyName]       = useState("");
  const [contactName, setContactName]       = useState("");
  const [contactEmail, setContactEmail]     = useState("");
  const [contactTitle, setContactTitle]     = useState("");
  const [currentProcess, setCurrentProcess] = useState("");
  const [painPoints, setPainPoints]         = useState("");
  const [additionalContext, setAdditional]  = useState("");
  const [answers, setAnswers]               = useState<Record<string, string>>({});
  const [submitted, setSubmitted]           = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [errorMsg, setErrorMsg]             = useState("");
  const [shareUrl, setShareUrl]             = useState("");

  useEffect(() => {
    fetch("/api/estimator/questions")
      .then((r) => r.json())
      .then((data) => setQuestions(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingQs(false));
  }, []);

  const visible = questions.filter((q) => isVisible(q, questions, answers));
  const cats = [...new Set(visible.map((q) => q.category))];
  const answeredCount = visible.filter((q) => answers[String(q.id)] !== undefined && answers[String(q.id)] !== "").length;
  const pct = visible.length > 0 ? Math.round((answeredCount / visible.length) * 100) : 0;
  const canSubmit = companyName.trim() && contactName.trim() && contactEmail.trim();

  function setAnswer(id: number, val: string) {
    setAnswers((prev) => ({ ...prev, [String(id)]: val }));
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/estimator/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name:       companyName.trim(),
          contact_name:       contactName.trim(),
          contact_email:      contactEmail.trim(),
          contact_title:      contactTitle.trim(),
          current_process:    currentProcess,
          pain_points:        painPoints,
          additional_context: additionalContext,
          answers,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShareUrl(data.shareUrl ?? "");
        setSubmitted(true);
      } else {
        setErrorMsg(data.error || "Submission failed. Please try again.");
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submitted confirmation ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", background: "linear-gradient(135deg, #eaf1ff 0%, #f8fafc 60%, #ffffff 100%)" }}>
        <div style={{ maxWidth: 500, width: "100%", textAlign: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#edf8f2", border: "2px solid #c0e8d0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 style={{ margin: "0 0 12px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>
            Thank you, {companyName}!
          </h1>
          <p style={{ margin: "0 0 10px", fontSize: 16, color: "#455468", lineHeight: 1.7 }}>
            Your assessment has been submitted. Your TapClicks implementation team will review your answers and be in touch within 2 business days.
          </p>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "#8a9bb0", lineHeight: 1.6 }}>
            In the meantime, if you have any questions please contact your TapClicks representative.
          </p>
          {shareUrl && (
            <div style={{ background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 12, padding: "14px 18px", textAlign: "left", marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, color: "#455468" }}>Need to update your answers? </span>
              <a href={shareUrl} style={{ color: "#2f6fed", fontWeight: 600, textDecoration: "none", fontSize: 13.5 }}>
                Edit your assessment →
              </a>
            </div>
          )}
          <div style={{ marginTop: 32, paddingTop: 28, borderTop: "1px solid #e8edf5", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#2f6fed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 12 }}>A</span>
            </div>
            <span style={{ fontSize: 13, color: "#8a9bb0", fontWeight: 600 }}>AdFlo by TapClicks</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", fontFamily: "'DM Sans', Arial, sans-serif" }}>

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#ffffff", borderBottom: "1px solid #dde5ef", boxShadow: "0 1px 4px rgba(16,24,40,0.06)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#2f6fed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>A</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623", lineHeight: 1.2 }}>AdFlo by TapClicks</div>
              <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 1 }}>Implementation Assessment</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#8a9bb0", fontWeight: 600 }}>{pct}% complete</div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 3, background: "#edf2f7" }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", width: `${pct}%`, transition: "width 0.4s ease" }} />
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "40px 24px 60px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ margin: "0 0 10px", fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>
            Implementation Assessment
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "#627286", lineHeight: 1.6 }}>
            Help us understand your needs so we can prepare your implementation plan.
          </p>
        </div>

        {/* ── Section 1: About You ── */}
        <SectionCard step="1" title="About You" subtitle="Tell us who you are and how to reach you.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FieldGroup label="Company Name" required>
              <input style={inputStyle} placeholder="e.g. Acme Media Group" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />
            </FieldGroup>
            <FieldGroup label="Your Name" required>
              <input style={inputStyle} placeholder="e.g. Jane Smith" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" />
            </FieldGroup>
            <FieldGroup label="Your Email" required>
              <input type="email" style={inputStyle} placeholder="jane@company.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} autoComplete="email" />
            </FieldGroup>
            <FieldGroup label="Your Role / Title" hint="optional">
              <input style={inputStyle} placeholder="e.g. VP of Operations" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} autoComplete="organization-title" />
            </FieldGroup>
          </div>
        </SectionCard>

        {/* ── Section 2: Business Context ── */}
        <SectionCard step="2" title="Tell Us About Your Business" subtitle="A few questions to help us understand where you are today. All fields optional.">
          <FieldGroup label="Current Process">
            <textarea
              style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
              placeholder="Briefly describe how you currently manage advertising orders and workflows. What systems do you use today?"
              value={currentProcess}
              onChange={(e) => setCurrentProcess(e.target.value)}
            />
          </FieldGroup>
          <FieldGroup label="Pain Points & Challenges">
            <textarea
              style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
              placeholder="What are the biggest challenges or frustrations with your current process? What would you most like to improve?"
              value={painPoints}
              onChange={(e) => setPainPoints(e.target.value)}
            />
          </FieldGroup>
          <FieldGroup label="Additional Context">
            <textarea
              style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
              placeholder="Is there anything else you'd like us to know before we prepare your implementation plan?"
              value={additionalContext}
              onChange={(e) => setAdditional(e.target.value)}
            />
          </FieldGroup>
        </SectionCard>

        {/* ── Section 3: Questions ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
            <StepBadge>3</StepBadge>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>Implementation Questions</div>
              <div style={{ fontSize: 13, color: "#627286", marginTop: 2 }}>Help us understand your technical needs. Answer what you can — takes about 5 minutes.</div>
            </div>
          </div>

          {/* Category progress chips */}
          {!loadingQs && cats.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {cats.map((cat) => {
                const catQs = visible.filter((q) => q.category === cat);
                const catAns = catQs.filter((q) => answers[String(q.id)] !== undefined && answers[String(q.id)] !== "").length;
                const done = catAns === catQs.length && catQs.length > 0;
                return (
                  <div key={cat} style={{ padding: "5px 12px", borderRadius: 999, border: `1px solid ${done ? "#c0e8d0" : "#dde5ef"}`, background: done ? "#edf8f2" : "#ffffff", fontSize: 11, fontWeight: 600, color: done ? "#1f9d55" : "#8a9bb0" }}>
                    {cat} · {catAns}/{catQs.length}
                  </div>
                );
              })}
            </div>
          )}

          {loadingQs ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#8a9bb0" }}>
              <div style={spinnerStyle} />
              <div style={{ marginTop: 10, fontSize: 13 }}>Loading questions…</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {cats.map((cat) => {
                const catQs = visible.filter((q) => q.category === cat);
                return (
                  <div key={cat}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a9bb0", marginBottom: 10 }}>{cat}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {catQs.map((q) => (
                        <QuestionCard key={q.id} q={q} value={answers[String(q.id)] ?? ""} onChange={(val) => setAnswer(q.id, val)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Submit ── */}
        <div style={{ background: "linear-gradient(135deg, #eaf1ff 0%, #f8fafc 100%)", border: "1px solid #cddcff", borderRadius: 18, padding: "24px 28px" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0f1623" }}>Questions answered</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2f6fed" }}>{answeredCount} / {visible.length}</span>
            </div>
            <div style={{ height: 6, background: "#dde9ff", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", width: `${pct}%`, transition: "width 0.4s ease", borderRadius: 999 }} />
            </div>
            {visible.length > 0 && answeredCount < visible.length && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#627286" }}>
                {visible.length - answeredCount} question{visible.length - answeredCount !== 1 ? "s" : ""} remaining — you can still submit without answering all of them.
              </div>
            )}
          </div>

          {!canSubmit && (
            <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fff8e8", border: "1px solid #f3e0a3", fontSize: 12.5, color: "#8a6417" }}>
              Please fill in Company Name, Your Name, and Email above to enable submit.
            </div>
          )}

          {errorMsg && (
            <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fff0f0", border: "1px solid #f9c0c0", fontSize: 12.5, color: "#c94b4b" }}>
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              width: "100%",
              padding: "14px 24px",
              borderRadius: 12,
              border: "none",
              background: canSubmit && !submitting ? "#2f6fed" : "#b0c4e8",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 15,
              cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.15s",
            }}
          >
            {submitting ? (
              <>
                <div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                Submitting…
              </>
            ) : "Submit Assessment →"}
          </button>

          {canSubmit && (
            <p style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "#8a9bb0" }}>
              Your responses will be reviewed by the TapClicks implementation team within 2 business days.
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 32, paddingTop: 24, borderTop: "1px solid #e8edf5" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: "#2f6fed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 10 }}>A</span>
            </div>
            <span style={{ fontSize: 12, color: "#8a9bb0", fontWeight: 600 }}>AdFlo by TapClicks</span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "#aab4c0" }}>Your information is kept confidential and used only for implementation planning.</p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ step, title, subtitle, children }: { step: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #dde5ef", borderRadius: 18, padding: "24px 28px", marginBottom: 20, boxShadow: "0 1px 4px rgba(16,24,40,0.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, paddingBottom: 16, marginBottom: 20, borderBottom: "1px solid #edf2f7" }}>
        <StepBadge>{step}</StepBadge>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: 13, color: "#627286", marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
    </div>
  );
}

function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 26, height: 26, borderRadius: 8, background: "#eaf1ff", border: "1px solid #cddcff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#2f6fed" }}>
      {children}
    </div>
  );
}

function FieldGroup({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8a9bb0", display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {required && <span style={{ color: "#e05a5a", fontWeight: 700 }}>*</span>}
        {hint && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#aab4c0" }}>({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function QuestionCard({ q, value, onChange }: { q: Question; value: string; onChange: (val: string) => void }) {
  const answered = value !== "" && value !== undefined;
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${answered ? "#b8cdf0" : "#dde5ef"}`, borderRadius: 14, padding: "16px 18px", boxShadow: answered ? "0 1px 6px rgba(47,111,237,0.07)" : "none", transition: "border-color 0.15s" }}>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: "#18212b", lineHeight: 1.55 }}>{q.question}</p>
      {q.question_type === "yesno" && (
        <div style={{ display: "flex", gap: 10 }}>
          {(["Yes", "No"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: `1px solid ${value === v ? (v === "Yes" ? "#1f9d55" : "#c94b4b") : "#dde5ef"}`,
                background: value === v ? (v === "Yes" ? "#1f9d55" : "#c94b4b") : "#f8fafc",
                color: value === v ? "#ffffff" : "#627286",
                fontWeight: 700,
                fontSize: 13.5,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.12s",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      {q.question_type === "number" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" onClick={() => onChange(String(Math.max(0, parseInt(value || "0", 10) - 1)))} style={stepperBtnStyle}>−</button>
          <input
            type="number"
            min={0}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            style={{ ...inputStyle, width: 80, textAlign: "center", padding: "8px 12px" }}
          />
          <button type="button" onClick={() => onChange(String(parseInt(value || "0", 10) + 1))} style={stepperBtnStyle}>+</button>
        </div>
      )}
      {q.question_type === "date" && (
        <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  background: "#ffffff",
  fontSize: 14,
  color: "#18212b",
  fontFamily: "'DM Sans', Arial, sans-serif",
  outline: "none",
  transition: "border-color 0.15s",
};

const stepperBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid #dde5ef",
  background: "#f8fafc",
  color: "#455468",
  fontWeight: 700,
  fontSize: 16,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
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
