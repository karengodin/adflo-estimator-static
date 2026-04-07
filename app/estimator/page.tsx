"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

// ─── Types ─────────────────────────────────────────────────────────────────

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
  lever_name?: string | null;
  lever_desc?: string | null;
};

type Session = {
  id: string;
  company_name: string | null;
  primary_contact: string | null;
  answers: Record<string, string>;
  activated_levers: number[];
  estimated_hours: number;
  tier: string;
  timeline: string | null;
  status: string | null;
  submitted_at: string;
  updated_at: string | null;
  notes: string | null;
};

type Logic = {
  baseHours: number;
  bestCaseMultiplier: number;
  worstCaseMultiplier: number;
  teamPin: string;
  tiers: { name: string; minHours: number; timeline: string }[];
};

type Screen = "loading" | "role" | "questionnaire" | "complete" | "team-dashboard" | "team-session";

const DEFAULT_LOGIC: Logic = {
  baseHours: 24,
  bestCaseMultiplier: 0.8,
  worstCaseMultiplier: 1.3,
  teamPin: "1234",
  tiers: [
    { name: "Bronze", minHours: 0, timeline: "3–5 weeks" },
    { name: "Silver", minHours: 60, timeline: "5–8 weeks" },
    { name: "Gold", minHours: 110, timeline: "8–12 weeks" },
    { name: "Enterprise", minHours: 180, timeline: "12–16 weeks" },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function calcHours(questions: Question[], answers: Record<string, string>, logic: Logic, excludeIds: number[] = []) {
  const excl = new Set(excludeIds);
  const w = questions.reduce((sum, q) => (!excl.has(q.id) && answers[String(q.id)] === q.trigger ? sum + q.weight : sum), 0);
  return {
    expected: Math.round(logic.baseHours + w),
    best: Math.round(logic.baseHours + w * logic.bestCaseMultiplier),
    worst: Math.round(logic.baseHours + w * logic.worstCaseMultiplier),
  };
}

function getTier(hours: number, logic: Logic) {
  const sorted = [...logic.tiers].sort((a, b) => b.minHours - a.minHours);
  return sorted.find((t) => hours >= t.minHours) || logic.tiers[0];
}

function getTierStyle(tierName: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 };
  if (tierName === "Bronze") return { ...base, background: "#fdf1e5", color: "#a8611a", border: "1px solid #f1d3b2" };
  if (tierName === "Silver") return { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #dbe3ec" };
  if (tierName === "Gold") return { ...base, background: "#fff7db", color: "#9a6b00", border: "1px solid #f1dd8c" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}

function getStatusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "capitalize" };
  if (status === "draft") return { ...base, background: "#fff8e8", color: "#8a6417", border: "1px solid #f3e0a3" };
  if (status === "reviewed") return { ...base, background: "#edf8f2", color: "#1f9d55", border: "1px solid #cfe7d7" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function EstimatorPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [logic, setLogic] = useState<Logic>(DEFAULT_LOGIC);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activatedLevers, setActivatedLevers] = useState<number[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [notes, setNotes] = useState("");
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeTab, setActiveTab] = useState<"questionnaire" | "levers" | "srd">("questionnaire");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // PIN modal
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");

  // New session modal
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionRep, setNewSessionRep] = useState("");
  const [newSessionError, setNewSessionError] = useState("");
  const [newSessionSaving, setNewSessionSaving] = useState(false);

  // Team dashboard tab
  const [dashTab, setDashTab] = useState<"sessions" | "history" | "logic">("sessions");
  const [sessionSearch, setSessionSearch] = useState("");
  const [history, setHistory] = useState<any[]>([]);

  // Logic editor local state
  const [logicEdit, setLogicEdit] = useState<Logic>(DEFAULT_LOGIC);
  const [questionsEdit, setQuestionsEdit] = useState<Question[]>([]);
  const [isSavingLogic, setIsSavingLogic] = useState(false);
  
  // SRD
  const [srdData, setSrdData] = useState({ executiveSummary: "", objectives: "", outOfScope: "", nextSteps: "" });

  // ── Load questions & logic on mount ──
  useEffect(() => {
    const init = async () => {
      const [{ data: qData }, { data: lData }] = await Promise.all([
        supabase.from("estimator_questions").select("*").eq("is_active", true).order("display_order"),
        supabase.from("estimator_logic").select("*").eq("id", "global").single(),
      ]);
     if (qData) {
  setQuestions(qData as Question[]);
  setQuestionsEdit(qData as Question[]);
}
      if (lData) {
        const l: Logic = {
          baseHours: lData.base_hours ?? 24,
          bestCaseMultiplier: lData.best_case_multiplier ?? 0.8,
          worstCaseMultiplier: lData.worst_case_multiplier ?? 1.3,
          teamPin: lData.team_pin ?? "1234",
          tiers: lData.tiers ?? DEFAULT_LOGIC.tiers,
        };
        setLogic(l);
        setLogicEdit(l);
      }
      setScreen("role");
    };
    init();
  }, []);

  // ── Derived values ──
  const est = useMemo(() => calcHours(questions, answers, logic, activatedLevers), [questions, answers, logic, activatedLevers]);
  const currentTier = useMemo(() => getTier(est.expected, logic), [est.expected, logic]);
  const answeredCount = Object.keys(answers).length;
  const categories = useMemo(() => [...new Set(questions.map((q) => q.category))], [questions]);
  const blockers = useMemo(() => questions.filter((q) => q.blocker && answers[String(q.id)] === q.trigger), [questions, answers]);
  const sowItems = useMemo(() => questions.filter((q) => q.sow && answers[String(q.id)] === q.trigger), [questions, answers]);
  const levers = useMemo(() => questions.filter((q) => q.can_remove && answers[String(q.id)] === q.trigger).sort((a, b) => b.weight - a.weight), [questions, answers]);
  const topLevers = levers.filter((q) => !activatedLevers.includes(q.id)).slice(0, 4);

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => (s.company_name || "").toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  // ── Auto-save ──
  const triggerSave = () => {
    if (!currentSession) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(() => persistSession(), 900);
  };

  const persistSession = async () => {
    if (!currentSession) return;
    const t = getTier(est.expected, logic);
    await supabase.from("estimator_submissions").update({
      company_name: companyName || "Untitled",
      primary_contact: contactName || null,
      notes: notes || null,
      answers,
      activated_levers: activatedLevers,
      estimated_hours: est.expected,
      tier: t.name,
      timeline: t.timeline,
      updated_at: new Date().toISOString(),
    }).eq("id", currentSession.id);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const setAnswer = (id: number, val: string) => {
    setAnswers((prev) => ({ ...prev, [String(id)]: val }));
    triggerSave();
  };

  const toggleLever = (id: number) => {
    setActivatedLevers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    triggerSave();
  };

  // ── Load sessions for team dashboard ──
  const loadSessions = async () => {
    const { data } = await supabase.from("estimator_submissions").select("*").order("updated_at", { ascending: false });
    setSessions((data as Session[]) || []);
  };

  const loadHistory = async () => {
    const { data } = await supabase.from("estimator_history").select("*").order("date_completed", { ascending: false });
    setHistory(data || []);
  };

  // ── Open session ──
  const openSession = async (id: string) => {
    setScreen("loading");
    const { data } = await supabase.from("estimator_submissions").select("*").eq("id", id).single();
    if (!data) { setScreen("team-dashboard"); return; }
    const s = data as Session;
    setCurrentSession(s);
    setAnswers(s.answers || {});
    setActivatedLevers(s.activated_levers || []);
    setCompanyName(s.company_name || "");
    setContactName(s.primary_contact || "");
    setNotes(s.notes || "");
    setActiveTab("questionnaire");
    setScreen("team-session");
  };

  // ── Create session ──
  const createSession = async () => {
    if (!newSessionName.trim()) { setNewSessionError("Please enter a client name."); return; }
    setNewSessionSaving(true);
    try {
      const { data, error } = await supabase.from("estimator_submissions").insert({
        company_name: newSessionName.trim(),
        primary_contact: newSessionRep.trim() || null,
        answers: {},
        activated_levers: [],
        estimated_hours: logic.baseHours,
        tier: "Bronze",
        timeline: logic.tiers[0]?.timeline || "3–5 weeks",
        status: "draft",
      }).select().single();
      if (error) throw error;
      setNewSessionOpen(false);
      setNewSessionName("");
      setNewSessionRep("");
      await openSession((data as Session).id);
    } catch (e: any) {
      setNewSessionError(e.message || "Error creating session");
    } finally {
      setNewSessionSaving(false);
    }
  };

  // ── Submit as client ──
  const submitClient = async () => {
    if (!currentSession) return;
    const t = getTier(est.expected, logic);
    await supabase.from("estimator_submissions").update({
      answers, estimated_hours: est.expected, tier: t.name, timeline: t.timeline,
      company_name: companyName, primary_contact: contactName, status: "submitted",
      updated_at: new Date().toISOString(),
    }).eq("id", currentSession.id);
    setScreen("complete");
  };

  // ── PIN ──
  const verifyPin = () => {
    if (pinValue === (logic.teamPin || "1234")) {
      setPinOpen(false); setPinValue(""); setPinError("");
      loadSessions(); loadHistory();
      setScreen("team-dashboard");
    } else {
      setPinError("Incorrect PIN");
    }
  };
// ── Question management ──
const addQuestion = () => {
  setQuestionsEdit((prev) => {
    const next = [
      ...prev,
      {
        id: Date.now(),
        category: "New",
        question: "New question",
        trigger: "Yes",
        weight: 1,
        can_remove: false,
        blocker: false,
        sow: false,
        is_active: true,
        display_order: prev.length + 1,
      },
    ];

    // scroll after render
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 50);

    return next;
  });
};

const deleteQuestion = (id: number) => {
  setQuestionsEdit((prev) => prev.filter((q) => q.id !== id));
};

const moveQuestion = (index: number, direction: "up" | "down") => {
  setQuestionsEdit((prev) => {
    const next = [...prev];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= next.length) return prev;

    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
  });
};
  const updateQuestionField = <K extends keyof Question>(
  index: number,
  field: K,
  value: Question[K]
) => {
  setQuestionsEdit((prev) => {
    const next = [...prev];
    next[index] = { ...next[index], [field]: value };
    return next;
  });
};
  // ── Save logic ──
const saveLogic = async () => {
  setIsSavingLogic(true);

  const { error: logicError } = await supabase.from("estimator_logic").upsert({
    id: "global",
    base_hours: logicEdit.baseHours,
    best_case_multiplier: logicEdit.bestCaseMultiplier,
    worst_case_multiplier: logicEdit.worstCaseMultiplier,
    team_pin: logicEdit.teamPin,
    tiers: logicEdit.tiers,
  });

  if (logicError) {
    console.error("Logic save error:", logicError);
    alert(`Logic save error: ${logicError.message}`);
    setIsSavingLogic(false);
    return;
  }

  const existingIds = questions.map((q) => q.id);
  const editedIds = questionsEdit.map((q) => q.id);
  const idsToDelete = existingIds.filter((id) => !editedIds.includes(id));

  for (const id of idsToDelete) {
    await supabase.from("estimator_questions").delete().eq("id", id);
  }

const payload = questionsEdit.map((q, i) => ({
  id: q.id,
  category: q.category,
  question: q.question,
  trigger: q.trigger,
  weight: q.weight,
  can_remove: q.can_remove,
  blocker: q.blocker,
  sow: q.sow,
  is_active: q.is_active,
  display_order: i + 1,
}));

const { error: questionsError } = await supabase
  .from("estimator_questions")
  .upsert(payload);

if (questionsError) {
  console.error("Question save error:", questionsError);
  alert(`Question save error: ${questionsError.message}`);
  setIsSavingLogic(false);
  return;
}

  setLogic(logicEdit);
  setQuestions(questionsEdit);
  setIsSavingLogic(false);
  alert("Logic saved");
};
  // ── Start client flow ──
  const startClientFlow = async () => {
    setScreen("loading");
    const { data, error } = await supabase.from("estimator_submissions").insert({
      answers: {}, activated_levers: [], estimated_hours: logic.baseHours,
      tier: "Bronze", timeline: logic.tiers[0]?.timeline || "3–5 weeks", status: "draft",
    }).select().single();
    if (error || !data) { setScreen("role"); return; }
    setCurrentSession(data as Session);
    setAnswers({});
    setActivatedLevers([]);
    setCompanyName("");
    setContactName("");
    setNotes("");
    setActiveTab("questionnaire");
    setScreen("questionnaire");
  };

  // ══════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════

  // ── Loading ──
  if (screen === "loading") {
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <div style={spinnerStyle} />
        <div style={{ fontSize: 13, color: "#627286" }}>Loading…</div>
      </div>
    );
  }

  // ── Role selection ──
  if (screen === "role") {
    return (
      <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623", marginBottom: 8 }}>
          adflo<span style={{ color: "#2f6fed" }}>Estimate</span>
        </div>
        <div style={{ fontSize: 15, color: "#627286", marginBottom: 40 }}>Select your role to continue</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
          <RoleCard icon="📋" title="Client / Sales" desc="Answer the onboarding questionnaire to help us understand your needs." onClick={startClientFlow} />
          <RoleCard icon="🔧" title="Implementation Team" desc="View estimates, sessions, and logic settings." onClick={() => { setPinOpen(true); setPinValue(""); setPinError(""); }} />
        </div>

        {/* PIN Modal */}
        {pinOpen && (
          <ModalOverlay onClose={() => setPinOpen(false)}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623", marginBottom: 6 }}>Implementation Team</div>
              <div style={{ fontSize: 13, color: "#627286", marginBottom: 20 }}>Enter your team PIN to continue</div>
              <input
                type="password"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verifyPin()}
                placeholder="····"
                autoFocus
                style={{ width: "100%", background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 14, fontSize: 22, letterSpacing: 6, textAlign: "center", padding: "14px", outline: "none", marginBottom: 8, fontFamily: "inherit", color: "#0f1623" }}
              />
              {pinError && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{pinError}</div>}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
                <button onClick={() => setPinOpen(false)} style={outlineBtnStyle}>Cancel</button>
                <button onClick={verifyPin} style={primaryBtnStyle}>Continue →</button>
              </div>
            </div>
          </ModalOverlay>
        )}
      </div>
    );
  }

  // ── Client questionnaire ──
  if (screen === "questionnaire") {
    return (
      <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>
        {/* Left sidebar */}
        <div style={{ width: 220, minWidth: 220, background: "#f7f9fc", borderRight: "1px solid #e3e9f1", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 18px 16px", borderBottom: "1px solid #dde5ef" }}>
            <div style={{ fontSize: 11, color: "#8a9bb0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12, fontWeight: 700 }}>Your Progress</div>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.04em", color: "#0f1623", marginBottom: 4 }}>{answeredCount}</div>
            <div style={{ fontSize: 13, color: "#627286", marginBottom: 14 }}>of {questions.length} questions answered</div>
            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}%`, background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", borderRadius: 999, transition: "width 0.3s" }} />
            </div>
          </div>
          <div style={{ padding: "14px 16px", flex: 1, overflowY: "auto" }}>
            {categories.map((cat) => {
              const qs = questions.filter((q) => q.category === cat);
              const done = qs.filter((q) => answers[String(q.id)]).length;
              const cls = done === qs.length ? "#4fbf9f" : done > 0 ? "#b7791f" : "#d0daea";
              return (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid #e8edf4", fontSize: 13, color: "#455468" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: cls, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{cat}</span>
                  <span style={{ fontSize: 11, color: "#8a9bb0" }}>{done}/{qs.length}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: "36px 40px 48px", overflowY: "auto" }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623", marginBottom: 6 }}>Implementation Questionnaire</h2>
            <p style={{ fontSize: 14, color: "#627286" }}>Help us understand your setup — this takes about 5 minutes</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            <div>
              <label style={fieldLabelStyle}>Company / Prospect</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" style={fieldInputStyle} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Primary Contact</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Smith" style={fieldInputStyle} />
            </div>
          </div>

          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>{cat}</div>
              {questions.filter((q) => q.category === cat).map((q) => {
                const a = answers[String(q.id)];
                return (
                  <div key={q.id} style={{ background: a === q.trigger ? "#eaf1ff" : "#fff", border: `1px solid ${a === q.trigger ? "#cddcff" : "#dde5ef"}`, borderRadius: 14, padding: "16px 18px", marginBottom: 10, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04)", transition: "all 0.15s" }}>
                    <div style={{ fontSize: 14, color: "#0f1623", lineHeight: 1.55, fontWeight: 500 }}>{q.question}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {["Yes", "No"].map((opt) => (
                        <button key={opt} type="button" onClick={() => setAnswer(q.id, opt)}
                          style={{ padding: "8px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#dde5ef"}`, background: a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#f8fafc", color: a === opt ? "#fff" : "#627286", transition: "all 0.15s", fontFamily: "inherit" }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
            <button onClick={submitClient} style={primaryBtnStyle}>Submit →</button>
            <button onClick={() => { setScreen("role"); setAnswers({}); }} style={outlineBtnStyle}>← Back</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Complete screen ──
  if (screen === "complete") {
    return (
      <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center", background: "#fff", border: "1px solid #dde5ef", borderRadius: 24, padding: "48px 40px", boxShadow: "0 1px 2px rgba(16,24,40,.05), 0 14px 28px rgba(16,24,40,.06)" }}>
          <div style={{ fontSize: 52, marginBottom: 20 }}>✅</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 12, color: "#0f1623" }}>All Done!</h2>
          <p style={{ fontSize: 15, color: "#627286", lineHeight: 1.7, marginBottom: 28 }}>
            Thank you for completing the questionnaire. Our implementation team will review your answers and reach out with a tailored proposal soon.
          </p>
          <div style={{ ...getTierStyle(currentTier.name), justifyContent: "center", marginBottom: 28, fontSize: 14, padding: "10px 22px" }}>
            ● {currentTier.name} Implementation · {currentTier.timeline}
          </div>
          <button onClick={() => setScreen("role")} style={outlineBtnStyle}>← Start Over</button>
        </div>
      </div>
    );
  }

  // ── Team dashboard ──
  if (screen === "team-dashboard") {
    const avgHours = sessions.length ? Math.round(sessions.reduce((s, x) => s + x.estimated_hours, 0) / sessions.length) : 0;
    const enterpriseCount = sessions.filter((s) => s.tier === "Enterprise").length;

    return (
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>Implementation Team</h1>
            <p style={{ marginTop: 6, color: "#627286", fontSize: 14, margin: "6px 0 0" }}>Manage sessions, history, and logic settings.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, background: "#eaf1ff", color: "#2f6fed", padding: "5px 12px", borderRadius: 999, border: "1px solid #cddcff" }}>🔧 Implementation Team</span>
            <button onClick={() => setScreen("role")} style={outlineBtnStyle}>← Exit</button>
            <button onClick={() => { setNewSessionOpen(true); setNewSessionName(""); setNewSessionRep(""); setNewSessionError(""); }} style={primaryBtnStyle}>+ New Session</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {(["sessions", "history", "logic"] as const).map((t) => (
            <button key={t} onClick={() => { setDashTab(t); if (t === "history") loadHistory(); if (t === "logic") setLogicEdit(logic); }} style={{ ...tabStyle, ...(dashTab === t ? activeTabStyle : {}) }}>
              {t === "sessions" ? "📋 Sessions" : t === "history" ? "📊 History" : "⚙️ Logic Editor"}
            </button>
          ))}
        </div>

        {/* Sessions tab */}
        {dashTab === "sessions" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              <MiniStat value={String(sessions.length)} label="Total Sessions" accent="#2f6fed" />
              <MiniStat value={String(sessions.filter((s) => s.status === "submitted" || s.status === "reviewed").length)} label="Submitted" accent="#4fbf9f" />
              <MiniStat value={String(avgHours)} label="Avg Est. Hours" accent="#7c5cbf" />
              <MiniStat value={String(enterpriseCount)} label="Enterprise Tier" accent="#e8974a" />
            </div>
            <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>
              <div style={{ padding: "16px 22px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f1623" }}>All Sessions</div>
                <input type="search" placeholder="Search clients…" value={sessionSearch} onChange={(e) => setSessionSearch(e.target.value)} style={{ width: 200, padding: "8px 14px", borderRadius: 10, border: "1px solid #dde5ef", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#f8fafc" }} />
              </div>
              {filteredSessions.length === 0 ? (
                <div style={{ padding: "52px 24px", textAlign: "center", color: "#8a9bb0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <div style={{ fontWeight: 700, color: "#0f1623", marginBottom: 6 }}>No sessions yet</div>
                  <div style={{ fontSize: 14, marginBottom: 20 }}>Create your first session to start estimating.</div>
                  <button onClick={() => setNewSessionOpen(true)} style={primaryBtnStyle}>+ New Session</button>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Client", "Status", "Tier", "Est. Hours", "Progress", "Rep", "Updated", ""].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((s, i) => {
                      const answered = Object.keys(s.answers || {}).length;
                      const pct = questions.length > 0 ? (answered / questions.length) * 100 : 0;
                      const isLast = i === filteredSessions.length - 1;
                      return (
                        <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => openSession(s.id)} onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                          <td style={{ ...tdStyle, fontWeight: 600, color: "#0f1623", borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>{s.company_name || "—"}</td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}><span style={getStatusStyle(s.status || "draft")}>{s.status || "draft"}</span></td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}><span style={getTierStyle(s.tier)}>• {s.tier}</span></td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>{s.estimated_hours} hrs</td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 72, height: 4, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #2f6fed, #4fbf9f)" }} />
                              </div>
                              <span style={{ fontSize: 11, color: "#8a9bb0" }}>{answered}/{questions.length}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7", color: "#8a9bb0" }}>{s.primary_contact || "—"}</td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7", color: "#8a9bb0", fontSize: 12 }}>{new Date(s.updated_at || s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                          <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid #edf2f7" }} onClick={(e) => e.stopPropagation()}><button onClick={() => openSession(s.id)} style={{ ...outlineBtnStyle, fontSize: 12, padding: "5px 12px" }}>Open →</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* History tab */}
        {dashTab === "history" && (
          <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid #dde5ef", fontSize: 15, fontWeight: 700, color: "#0f1623" }}>Project History</div>
            <div style={{ padding: 22 }}>
              <p style={{ fontSize: 13, color: "#627286", marginBottom: 16 }}>Log completed projects to track estimate accuracy.</p>
              {history.length === 0 ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: "#8a9bb0", fontSize: 14 }}>No history yet — log your first completed project.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>{["Client", "Date", "Rep", "Estimated", "Actual", "Variance", "Tier"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {history.map((h: any, i) => {
                      const v = h.actual_hours - h.estimated_hours;
                      return (
                        <tr key={i}>
                          <td style={tdStyle}>{h.client_name}</td>
                          <td style={tdStyle}>{h.date_completed}</td>
                          <td style={tdStyle}>{h.rep_name || "—"}</td>
                          <td style={tdStyle}>{h.estimated_hours}</td>
                          <td style={tdStyle}>{h.actual_hours}</td>
                          <td style={{ ...tdStyle, color: v > 0 ? "#dc2626" : v < 0 ? "#1f9d55" : "#627286", fontWeight: 600 }}>{v > 0 ? "+" : ""}{v}</td>
                          <td style={tdStyle}><span style={getTierStyle(h.tier)}>• {h.tier}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Logic editor tab */}
        {dashTab === "logic" && (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Base Settings</div>
                {[{ label: "Base Hours", key: "baseHours", unit: "hrs" }, { label: "Best Case", key: "bestCaseMultiplier", unit: "×" }, { label: "Worst Case", key: "worstCaseMultiplier", unit: "×" }].map(({ label, key, unit }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: "#455468", flex: 1 }}>{label}</span>
                    <input type="number" value={(logicEdit as any)[key]} onChange={(e) => setLogicEdit((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))} style={{ ...logicInputStyle }} />
                    <span style={{ fontSize: 11, color: "#8a9bb0", width: 24 }}>{unit}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Tier Thresholds</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>{["Tier", "Min Hours", "Timeline"].map((h) => <th key={h} style={{ ...thStyle, padding: "6px 8px" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {logicEdit.tiers.map((t, i) => (
                      <tr key={t.name}>
                        <td style={{ padding: "7px 8px" }}><span style={getTierStyle(t.name)}>● {t.name}</span></td>
                        <td style={{ padding: "7px 8px" }}><input type="number" value={t.minHours} onChange={(e) => setLogicEdit((prev) => { const tiers = [...prev.tiers]; tiers[i] = { ...tiers[i], minHours: parseInt(e.target.value) }; return { ...prev, tiers }; })} style={{ ...logicInputStyle, width: 70 }} /></td>
                        <td style={{ padding: "7px 8px" }}><input value={t.timeline} onChange={(e) => setLogicEdit((prev) => { const tiers = [...prev.tiers]; tiers[i] = { ...tiers[i], timeline: e.target.value }; return { ...prev, tiers }; })} style={{ ...logicInputStyle, width: 130 }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Questions table */}
            <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 22px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
  <div style={{ fontSize: 15, fontWeight: 700, color: "#0f1623" }}>Questions</div>
  <button onClick={addQuestion} style={{ ...outlineBtnStyle, fontSize: 12, padding: "6px 12px" }}>
    + Add Question
  </button>
</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>{["#", "", "Category", "Question", "Trigger", "Wt", "Removable", "Blocker", "SOW", ""].map((h) => <th key={h} style={{ ...thStyle, padding: "8px 12px" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {questionsEdit.map((q, i) => (
                      <tr key={q.id} style={{ borderBottom: "1px solid #edf2f7" }}>
<td style={{ padding: "8px 12px", color: "#8a9bb0" }}>{i + 1}</td>

<td style={{ padding: "8px 6px" }}>
  <button onClick={() => moveQuestion(i, "up")} style={{ marginRight: 4 }}>↑</button>
  <button onClick={() => moveQuestion(i, "down")}>↓</button>
</td>

<td style={{ padding: "8px 12px" }}>
                      		<input
  						  		value={q.category}
   						  		onChange={(e) => updateQuestionField(i, "category", e.target.value)}
   						  		style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
					  		/>
						</td>
                        <td style={{ padding: "8px 12px", maxWidth: 320 }}>
  <input
    value={q.question}
    onChange={(e) => updateQuestionField(i, "question", e.target.value)}
    style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
  />
</td>
                        <td style={{ padding: "8px 12px" }}>
  <select
    value={q.trigger}
    onChange={(e) => updateQuestionField(i, "trigger", e.target.value)}
    style={{ fontSize: 12 }}
  >
    <option value="Yes">Yes</option>
    <option value="No">No</option>
  </select>
</td>
                        <td style={{ padding: "8px 12px" }}>
  <input
    type="number"
    value={q.weight}
    onChange={(e) => updateQuestionField(i, "weight", Number(e.target.value))}
    style={{ width: 60, padding: "4px 6px", fontSize: 12 }}
  />
</td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
  <input
    type="checkbox"
    checked={q.can_remove}
    onChange={(e) => updateQuestionField(i, "can_remove", e.target.checked)}
  />
</td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
  <input
    type="checkbox"
    checked={q.blocker}
    onChange={(e) => updateQuestionField(i, "blocker", e.target.checked)}
  />
</td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
  <input
    type="checkbox"
    checked={q.sow}
    onChange={(e) => updateQuestionField(i, "sow", e.target.checked)}
  />
</td>
<td style={{ padding: "8px 12px" }}>
  <button
    onClick={() => deleteQuestion(q.id)}
    style={{
      fontSize: 11,
      padding: "4px 8px",
      borderRadius: 6,
      border: "1px solid #fca5a5",
      background: "#fee2e2",
      color: "#991b1b",
      cursor: "pointer",
    }}
  >
    Delete
  </button>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
  <button onClick={addQuestion} style={outlineBtnStyle}>
    + Add Question
  </button>

  <button onClick={saveLogic} disabled={isSavingLogic} style={primaryBtnStyle}>
    {isSavingLogic ? "Saving..." : "💾 Save Logic"}
  </button>
</div>
          </div>
        )}

        {/* New session modal */}
        {newSessionOpen && (
          <ModalOverlay onClose={() => setNewSessionOpen(false)}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623", marginBottom: 6 }}>New Estimation Session</div>
            <div style={{ fontSize: 13, color: "#627286", marginBottom: 20 }}>Creates a session for a client or prospect.</div>
            <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={fieldLabelStyle}>Client / Company Name *</label>
                <input value={newSessionName} onChange={(e) => setNewSessionName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createSession()} placeholder="Acme Corp" style={fieldInputStyle} autoFocus />
              </div>
              <div>
                <label style={fieldLabelStyle}>Sales Rep</label>
                <input value={newSessionRep} onChange={(e) => setNewSessionRep(e.target.value)} placeholder="Your name" style={fieldInputStyle} />
              </div>
            </div>
            {newSessionError && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{newSessionError}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setNewSessionOpen(false)} style={outlineBtnStyle}>Cancel</button>
              <button onClick={createSession} disabled={newSessionSaving} style={primaryBtnStyle}>{newSessionSaving ? "Creating…" : "Create Session →"}</button>
            </div>
          </ModalOverlay>
        )}
      </div>
    );
  }

  // ── Team session view ──
  if (screen === "team-session") {
    return (
      <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>

        {/* Team sidebar */}
        <div style={{ width: 236, minWidth: 236, background: "#f7f9fc", borderRight: "1px solid #e3e9f1", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 18px 16px", borderBottom: "1px solid #dde5ef" }}>
            <div style={{ fontSize: 11, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 12 }}>Live Estimate</div>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.04em", color: "#0f1623", marginBottom: 4 }}>{est.expected}</div>
            <div style={{ fontSize: 13, color: "#627286", marginBottom: 12 }}>expected hrs</div>
            <div style={getTierStyle(currentTier.name)}>● {currentTier.name}</div>
            <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 8 }}>Best: {est.best} · Worst: {est.worst}</div>
            <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", margin: "12px 0 8px" }}>
              <div style={{ height: "100%", width: `${Math.min((est.expected / 300) * 100, 100)}%`, background: "linear-gradient(90deg, #2f6fed, #4fbf9f)", borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8a9bb0" }}>
              <span>Timeline: {currentTier.timeline}</span>
              <span>{answeredCount}/{questions.length}</span>
            </div>
          </div>

          {/* Top levers */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #dde5ef" }}>
            <div style={{ fontSize: 11, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Top Levers</div>
            {topLevers.length > 0 ? topLevers.map((q) => (
              <div key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #e8edf4", fontSize: 12 }}>
                <span style={{ color: "#455468" }}>{q.lever_name || q.question.slice(0, 30)}</span>
                <button onClick={() => toggleLever(q.id)} style={{ color: "#1f9d55", fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>−{q.weight}h</button>
              </div>
            )) : <div style={{ fontSize: 12, color: "#8a9bb0" }}>No removable items triggered yet</div>}
          </div>

          {/* Blocker/SOW flags */}
          {(blockers.length > 0 || sowItems.length > 0) && (
            <div style={{ padding: "12px 16px", background: "#fff8e8", borderBottom: "1px solid #f3e0a3" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>⚠️ Scope Flags</div>
              {blockers.map((q) => <div key={q.id} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4 }}>🔴 {q.question.slice(0, 45)}…</div>)}
              {sowItems.map((q) => <div key={q.id} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4 }}>📋 {q.question.slice(0, 45)}…</div>)}
            </div>
          )}

          {/* Back + save status */}
          <div style={{ padding: "14px 16px", marginTop: "auto", borderTop: "1px solid #dde5ef" }}>
            {saveStatus && <div style={{ fontSize: 11, color: saveStatus === "saved" ? "#1f9d55" : "#8a9bb0", marginBottom: 8 }}>{saveStatus === "saving" ? "Saving…" : "✓ Saved"}</div>}
            <button onClick={async () => { await persistSession(); await loadSessions(); setScreen("team-dashboard"); }} style={{ ...outlineBtnStyle, width: "100%", textAlign: "center" }}>← Sessions</button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 24px", borderBottom: "1px solid #dde5ef", background: "rgba(255,255,255,0.9)" }}>
            <span style={{ fontSize: 12, fontWeight: 700, background: "#eaf1ff", color: "#2f6fed", padding: "5px 12px", borderRadius: 999, border: "1px solid #cddcff", marginRight: 8 }}>🔧 Team View</span>
            {(["questionnaire", "levers", "srd"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{ ...tabStyle, ...(activeTab === t ? activeTabStyle : {}) }}>
                {t === "questionnaire" ? "Questionnaire" : t === "levers" ? "🎛 Levers" : "📄 SRD"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 48px" }}>
            {/* Questionnaire tab */}
            {activeTab === "questionnaire" && (
              <>
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f1623", marginBottom: 6 }}>Questionnaire</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                    <div><label style={fieldLabelStyle}>Client / Company</label><input value={companyName} onChange={(e) => { setCompanyName(e.target.value); triggerSave(); }} style={fieldInputStyle} /></div>
                    <div><label style={fieldLabelStyle}>Sales Rep</label><input value={contactName} onChange={(e) => { setContactName(e.target.value); triggerSave(); }} style={fieldInputStyle} /></div>
                  </div>
                </div>
                {categories.map((cat) => (
                  <div key={cat} style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>{cat}</div>
                    {questions.filter((q) => q.category === cat).map((q) => {
                      const a = answers[String(q.id)];
                      const triggered = a === q.trigger;
                      const levered = activatedLevers.includes(q.id);
                      return (
                        <div key={q.id} style={{ background: triggered ? "#eaf1ff" : "#fff", border: `1px solid ${triggered ? "#cddcff" : "#dde5ef"}`, borderRadius: 14, padding: "16px 18px", marginBottom: 10, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 14, color: "#0f1623", lineHeight: 1.55, fontWeight: 500 }}>{q.question}</div>
                            <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <span>{q.weight} hrs</span>
                              {triggered && <span style={{ color: "#2f6fed", fontWeight: 700 }}>↑ adds hours</span>}
                              {q.blocker && triggered && <span style={{ color: "#dc2626", fontWeight: 700 }}>🔴 Blocker</span>}
                              {q.sow && triggered && <span style={{ color: "#b7791f", fontWeight: 700 }}>📋 SOW</span>}
                              {levered && <span style={{ color: "#1f9d55", fontWeight: 700 }}>✓ Levered out</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {["Yes", "No"].map((opt) => (
                              <button key={opt} type="button" onClick={() => setAnswer(q.id, opt)}
                                style={{ padding: "8px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#dde5ef"}`, background: a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#f8fafc", color: a === opt ? "#fff" : "#627286", fontFamily: "inherit" }}>
                                {opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <button onClick={() => { answers && persistSession(); }} style={primaryBtnStyle}>💾 Save</button>
              </>
            )}

            {/* Levers tab */}
            {activeTab === "levers" && (
              <>
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f1623", marginBottom: 6 }}>Scope Reduction Levers</h2>
                  <p style={{ fontSize: 14, color: "#627286" }}>Toggle features off to reduce hours or drop a tier.</p>
                  <div style={{ marginTop: 12, fontSize: 13, color: "#455468" }}>💡 Current estimate: <strong>{est.expected} hours</strong> · {currentTier.name}</div>
                  {activatedLevers.length > 0 && (
                    <div style={{ marginTop: 8, padding: "10px 14px", background: "#edf8f2", border: "1px solid #cfe7d7", borderRadius: 12, fontSize: 13, color: "#1f9d55", fontWeight: 600 }}>
                      ⚡ Adjusted: {est.expected} hrs · {currentTier.name} (saving {activatedLevers.reduce((s, id) => { const q = questions.find((x) => x.id === id); return s + (q?.weight || 0); }, 0)} hrs)
                    </div>
                  )}
                </div>
                {levers.length === 0 ? (
                  <div style={{ padding: "60px 0", textAlign: "center", color: "#8a9bb0" }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>🎛️</div>
                    <div>No removable items triggered yet. Answer the questionnaire first.</div>
                  </div>
                ) : levers.map((q) => {
                  const on = activatedLevers.includes(q.id);
                  return (
                    <div key={q.id} onClick={() => toggleLever(q.id)} style={{ background: on ? "#f6fbf8" : "#fff", border: `1px solid ${on ? "#cfe7d7" : "#dde5ef"}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "space-between", transition: "all 0.15s" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f1623", marginBottom: 4 }}>{q.lever_name || q.question}</div>
                        {q.lever_desc && <div style={{ fontSize: 12, color: "#627286" }}>{q.lever_desc}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: on ? "#1f9d55" : "#627286" }}>{on ? "✓ Removed" : `−${q.weight} hrs`}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* SRD tab */}
            {activeTab === "srd" && (
              <>
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f1623", marginBottom: 6 }}>SRD Generator</h2>
                  <p style={{ fontSize: 14, color: "#627286" }}>Auto-populated from answers — edit then export.</p>
                </div>
                {[{ key: "executiveSummary", label: "Executive Summary", rows: 4 }, { key: "objectives", label: "Business Objectives", rows: 4 }, { key: "outOfScope", label: "Out of Scope", rows: 3 }, { key: "nextSteps", label: "Next Steps", rows: 3 }].map(({ key, label, rows }) => (
                  <div key={key} style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, padding: 22, marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{label}</div>
                    <textarea value={(srdData as any)[key]} onChange={(e) => setSrdData((prev) => ({ ...prev, [key]: e.target.value }))} rows={rows} style={{ width: "100%", background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 12, color: "#0f1623", fontFamily: "inherit", fontSize: 13, padding: "12px 14px", outline: "none", resize: "vertical" }} />
                  </div>
                ))}
                {/* Estimate summary */}
                <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, padding: 22, marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Estimate Summary</div>
                  <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                    {[["Client", companyName || "—"], ["Estimated Hours", `${est.expected} hrs`], ["Tier", currentTier.name], ["Timeline", currentTier.timeline], ["Blockers", String(blockers.length)], ["SOW Items", String(sowItems.length)]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #edf2f7" }}>
                        <span style={{ color: "#627286" }}>{k}</span>
                        <span style={{ fontWeight: 600, color: "#0f1623" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RoleCard({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ width: 300, background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, padding: "24px", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.04)", transition: "all 0.2s" }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,24,40,.05), 0 14px 28px rgba(16,24,40,.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.04)"; }}>
      <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "#0f1623" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#627286", lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

function MiniStat({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 5, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,22,35,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.16)" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = { padding: "10px 18px", borderRadius: 10, border: "none", background: "#2f6fed", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13.5, fontFamily: "inherit" };
const outlineBtnStyle: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "1px solid #dde5ef", background: "#fff", color: "#455468", fontWeight: 600, cursor: "pointer", fontSize: 13.5, fontFamily: "inherit" };
const fieldLabelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 };
const fieldInputStyle: React.CSSProperties = { width: "100%", background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 12, color: "#0f1623", fontFamily: "inherit", fontSize: 14, padding: "10px 14px", outline: "none", boxSizing: "border-box" };
const tabStyle: React.CSSProperties = { padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#627286", border: "1px solid transparent", background: "transparent", fontFamily: "inherit" };
const activeTabStyle: React.CSSProperties = { background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 18px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0", fontWeight: 700, borderBottom: "1px solid #dde5ef" };
const tdStyle: React.CSSProperties = { padding: "13px 18px", color: "#455468", verticalAlign: "middle" };
const logicInputStyle: React.CSSProperties = { background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 8, color: "#0f1623", fontFamily: "inherit", fontSize: 13, padding: "6px 10px", outline: "none", width: 80, textAlign: "right" };
const spinnerStyle: React.CSSProperties = { width: 32, height: 32, border: "3px solid #dde5ef", borderTopColor: "#2f6fed", borderRadius: "50%", animation: "spin 0.7s linear infinite" };
