"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ProjectTab from "./sessions/[id]/ProjectTab";

// ─── Types ─────────────────────────────────────────────────────────────────

type Question = {
  id: number;
  category: string;
  impl_category: string | null;
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
  // v2 fields
  question_type: "yesno" | "number" | "date";
  conditional_logic: {
    type: "any_answered_yes_or_nonzero" | "greater_than";
    sort_orders?: number[];
    sort_order?: number;
    value?: number;
  } | null;
  is_risk_multiplier: boolean;
  risk_multiplier_value: number | null;
  risk_direction: "yes_adds_hours" | "no_adds_risk" | null;
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
  tiers: { name: string; minHours: number; timeline: string }[];
  productHourRate: number;
  connectorHourRate: number;
  riskMultipliers: { sort_order: number; condition: string; multiplier: number }[];
};

type Screen = "loading" | "role" | "questionnaire" | "complete" | "team-dashboard" | "team-session";

type SrdBreakdownRow = { label: string; hours: number; detail: string[] };

type SrdData = {
  engagement_overview: string;
  customer_objectives: string[];
  system_architecture: string;
  in_scope: {
    narrative: string;
    hours_breakdown: {
      rows: SrdBreakdownRow[];
      total: number;
    };
  };
  out_of_scope: string[];
  integration_strategy: string | null;
  risks_and_flags: string[];
  meta: {
    clientName: string | null;
    repName: string | null;
    estimatedHours: number;
    tier: string;
    generatedAt: string;
    generated_by?: "template" | "ai";
  };
};

// Team PIN — not stored in DB (internal tool, no auth yet)
const TEAM_PIN = "1234";

const DEFAULT_LOGIC: Logic = {
  baseHours: 0,
  bestCaseMultiplier: 0.8,
  worstCaseMultiplier: 1.3,
  tiers: [
    { name: "Bronze",     minHours: 0,   timeline: "3–5 weeks" },
    { name: "Silver",     minHours: 61,  timeline: "5–8 weeks" },
    { name: "Gold",       minHours: 121, timeline: "8–12 weeks" },
    { name: "Enterprise", minHours: 201, timeline: "12–16 weeks" },
  ],
  productHourRate:   4,
  connectorHourRate: 12,
  riskMultipliers: [
    { sort_order: 23, condition: "No", multiplier: 1.15 },
    { sort_order: 24, condition: "No", multiplier: 1.10 },
    { sort_order: 25, condition: "No", multiplier: 1.20 },
    { sort_order: 26, condition: "No", multiplier: 1.10 },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getTier(hours: number, logic: Logic) {
  const sorted = [...logic.tiers].sort((a, b) => b.minHours - a.minHours);
  return sorted.find((t) => hours >= t.minHours) || logic.tiers[0];
}

/** Returns true if the question should be shown given current answers. */
function isVisible(q: Question, allQuestions: Question[], answers: Record<string, string>): boolean {
  const cl = q.conditional_logic;
  if (!cl) return true;

  const bySort = (n: number) => allQuestions.find((x) => x.display_order === n);
  const isAnsweredYesOrNonzero = (dep: Question) => {
    const a = answers[String(dep.id)];
    if (dep.question_type === "number") return parseInt(a || "0", 10) > 0;
    return a === "Yes";
  };

  if (cl.type === "any_answered_yes_or_nonzero") {
    return (cl.sort_orders ?? []).some((so) => {
      const dep = bySort(so);
      return dep ? isAnsweredYesOrNonzero(dep) : false;
    });
  }

  if (cl.type === "greater_than") {
    const dep = bySort(cl.sort_order!);
    if (!dep) return false;
    const val = parseInt(answers[String(dep.id)] || "0", 10) || 0;
    return val > (cl.value ?? 0);
  }

  return true;
}

type EstResult = {
  base: number;
  products: number;
  connectors: number;
  subtotal: number;
  multiplier: number;
  expected: number;
  best: number;
  worst: number;
  redFlags: string[];
};

function calcEstimate(questions: Question[], answers: Record<string, string>, logic: Logic): EstResult {
  const bySort = (n: number) => questions.find((q) => q.display_order === n);

  // 1. Base hours: yesno non-risk questions answered Yes × weight
  let base = 0;
  for (const q of questions) {
    if (q.question_type === "yesno" && !q.is_risk_multiplier && answers[String(q.id)] === "Yes") {
      base += q.weight;
    }
  }

  // 2. Product hours — tiered (Q13), optionally × 1.5 for flights (Q14)
  const q13 = bySort(13);
  const q14 = bySort(14);
  let products = 0;
  if (q13) {
    const count = parseInt(answers[String(q13.id)] || "0", 10) || 0;
    if (count > 0) {
      const rate = logic.productHourRate ?? 4;
      let p: number;
      if (count <= 3)      p = count * rate;
      else if (count <= 8) p = count * (rate * 0.75);
      else                 p = count * (rate * 0.5);
      if (q14 && answers[String(q14.id)] === "Yes") p *= 1.5;
      products = Math.round(p);
    }
  }

  // 3. Push connector hours (Q12 count × connectorHourRate)
  const q12 = bySort(12);
  let connectors = 0;
  if (q12) {
    const count = parseInt(answers[String(q12.id)] || "0", 10) || 0;
    connectors = count * (logic.connectorHourRate ?? 12);
  }

  const subtotal = base + products + connectors;

  // 4. Org readiness multipliers (stack multiplicatively, driven by logic.riskMultipliers)
  const q23 = bySort(23); const q24 = bySort(24);
  const q25 = bySort(25); const q26 = bySort(26);

  const hasIntegrations = questions
    .filter((q) => q.display_order >= 7 && q.display_order <= 12)
    .some((q) => {
      const a = answers[String(q.id)];
      return q.question_type === "number" ? parseInt(a || "0", 10) > 0 : a === "Yes";
    });

  let multiplier = 1.0;
  for (const rm of (logic.riskMultipliers ?? [])) {
    const q = bySort(rm.sort_order);
    if (!q) continue;
    if (answers[String(q.id)] !== rm.condition) continue;
    if (rm.sort_order === 26 && !hasIntegrations) continue;
    multiplier *= rm.multiplier;
  }

  const expected = Math.round(subtotal * multiplier);

  // 5. Red flags
  const redFlags: string[] = [];
  if (q23 && answers[String(q23.id)] === "No")
    redFlags.push("No dedicated implementation lead — timeline risk (+15%)");
  if (q24 && answers[String(q24.id)] === "No")
    redFlags.push("Workflows not documented — discovery phase required (+10%)");
  if (q25 && answers[String(q25.id)] === "No")
    redFlags.push("Stakeholders not aligned on workflows — scope risk (+20%)");
  if (q26 && answers[String(q26.id)] === "No" && hasIntegrations)
    redFlags.push("No technical resource for integrations — delivery risk (+10%)");

  const q27 = bySort(27);
  if (q27 && answers[String(q27.id)]) {
    const goLive = new Date(answers[String(q27.id)]);
    const eightWeeks = new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000);
    if (goLive < eightWeeks) {
      redFlags.push(`Target go-live ${answers[String(q27.id)]} is aggressive (under 8 weeks)`);
    }
  }

  return {
    base,
    products,
    connectors,
    subtotal,
    multiplier,
    expected,
    best:  Math.round(expected * (logic.bestCaseMultiplier ?? 0.8)),
    worst: Math.round(expected * (logic.worstCaseMultiplier ?? 1.3)),
    redFlags,
  };
}

function getTierStyle(tierName: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 };
  if (tierName === "Bronze") return { ...base, background: "#fdf1e5", color: "#a8611a", border: "1px solid #f1d3b2" };
  if (tierName === "Silver") return { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #dbe3ec" };
  if (tierName === "Gold") return { ...base, background: "#fff7db", color: "#9a6b00", border: "1px solid #f1dd8c" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}

// ─── Template SRD Generator ────────────────────────────────────────────────

function generateTemplateSRD(
  session: Session,
  questions: Question[],
  logic: Logic,
  est: EstResult,
): SrdData {
  const clientName = session.company_name || "Client";
  const repName    = session.primary_contact || "TapClicks Team";
  const answers    = session.answers || {};

  const bySort = (n: number) => questions.find((q) => q.display_order === n);
  const yes    = (n: number) => { const q = bySort(n); return q ? answers[String(q.id)] === "Yes" : false; };
  const num    = (n: number) => { const q = bySort(n); return q ? parseInt(answers[String(q.id)] || "0", 10) || 0 : 0; };

  // ── Customer Objectives ──
  const objectives: string[] = [];
  const OBJ: Array<{ s: number; t: "yesno" | "number"; txt: (n: number) => string }> = [
    { s: 1,  t: "yesno",  txt: () => "Establish AdFlo as the single source of truth for all campaign and order data" },
    { s: 2,  t: "yesno",  txt: () => "Migrate historical campaign and order data into AdFlo" },
    { s: 3,  t: "yesno",  txt: () => "Configure multi-step approval workflows for order activation" },
    { s: 4,  t: "yesno",  txt: () => "Enable cross-departmental approval routing (Sales, Finance, Operations)" },
    { s: 5,  t: "yesno",  txt: () => "Implement conditional workflow routing with if/then business rules" },
    { s: 6,  t: "yesno",  txt: () => "Automate SLA tracking and deadline management within workflows" },
    { s: 7,  t: "yesno",  txt: () => "Integrate AdFlo with the existing CRM system for unified data management" },
    { s: 8,  t: "yesno",  txt: () => "Connect AdFlo with proposal and quoting tools for streamlined order creation" },
    { s: 9,  t: "yesno",  txt: () => "Integrate with billing and finance systems for automated revenue tracking" },
    { s: 10, t: "yesno",  txt: () => "Connect external platform data to AdFlo via API or webhook" },
    { s: 11, t: "yesno",  txt: () => "Enable bi-directional data sync across integrated systems" },
    { s: 12, t: "number", txt: (n) => `Configure ${n} push connector${n !== 1 ? "s" : ""} to ad servers and external vendors` },
    { s: 13, t: "number", txt: (n) => `Configure ${n} product form${n !== 1 ? "s" : ""} within AdFlo` },
    { s: 14, t: "yesno",  txt: () => "Enable flight forms and workflow automation for product management" },
    { s: 15, t: "yesno",  txt: () => "Build custom task forms to support operational workflows" },
    { s: 16, t: "yesno",  txt: () => "Configure buy sheet and IO export templates" },
    { s: 17, t: "yesno",  txt: () => "Support multiple business units or brands within a single AdFlo instance" },
    { s: 18, t: "yesno",  txt: () => "Implement role-based access controls and permission tiers" },
    { s: 19, t: "yesno",  txt: () => "Enable custom financial tracking including margin, COGS, and reconciliation" },
    { s: 20, t: "yesno",  txt: () => "Automate billing and invoice generation within the platform" },
    { s: 21, t: "yesno",  txt: () => "Support revenue adjustments via change order workflows" },
    { s: 22, t: "yesno",  txt: () => "Provide campaign pacing data and in-flight performance visibility" },
    { s: 28, t: "yesno",  txt: () => "Scale the platform to support 20+ concurrent users" },
    { s: 29, t: "yesno",  txt: () => "Support multi-market or multi-region operations within AdFlo" },
  ];
  for (const { s, t, txt } of OBJ) {
    if (t === "yesno" && yes(s)) objectives.push(txt(0));
    if (t === "number") { const n = num(s); if (n > 0) objectives.push(txt(n)); }
  }

  // ── System Architecture ──
  const productCount   = num(13);
  const hasFlight      = yes(14);
  const connectorCount = num(12);
  const hasIntegrations = [7,8,9,10,11].some((s) => yes(s)) || connectorCount > 0;

  let arch = "The order structure will follow: One Order per Campaign. ";
  if (productCount > 0) {
    arch += `${productCount} product form${productCount !== 1 ? "s" : ""} configured`;
    arch += hasFlight ? ", with flight forms and workflows. " : ", without flight-level forms. ";
  } else {
    arch += "Product configuration to be defined during discovery. ";
  }
  if (hasIntegrations) {
    const parts: string[] = [];
    if (yes(7))           parts.push("CRM system");
    if (yes(8))           parts.push("proposal/quoting tools");
    if (yes(9))           parts.push("billing/finance systems");
    if (yes(10))          parts.push("external API/webhook connections");
    if (yes(11))          parts.push("bi-directional sync");
    if (connectorCount > 0) parts.push(`${connectorCount} push connector${connectorCount !== 1 ? "s" : ""}`);
    if (parts.length)     arch += `Integration connections include: ${parts.join(", ")}.`;
  }

  // ── Hours Breakdown ──
  // Form Configuration
  const q15 = bySort(15); const taskHrs = (q15 && answers[String(q15.id)] === "Yes") ? 5 : 0;
  const q16 = bySort(16); const buyHrs  = (q16 && answers[String(q16.id)] === "Yes") ? 5 : 0;
  const formTotal = est.products + taskHrs + buyHrs;
  const formDetail: string[] = [];
  if (productCount > 0) {
    let desc = `${productCount} product form${productCount !== 1 ? "s" : ""}`;
    if (hasFlight) desc += ", with flight forms and workflows";
    formDetail.push(desc);
  }
  if (taskHrs) formDetail.push("Custom task forms");
  if (buyHrs)  formDetail.push("Buy sheets and IO exports");

  // Workflow Configuration (includes data & structure + scale)
  const WORKFLOW_LABELS: Record<number, string> = {
    1: "Single source of truth configuration",
    2: "Historical data import",
    3: "Multi-step approval workflows",
    4: "Cross-departmental approval routing",
    5: "Conditional workflow routing",
    6: "Automated SLA tracking",
    28: "User scale configuration (20+ users)",
    29: "Multi-market / multi-region configuration",
  };
  const workflowDetail: string[] = [];
  let workflowTotal = 0;
  for (const s of [1,2,3,4,5,6,28,29]) {
    if (yes(s)) { const q = bySort(s); if (q) { workflowTotal += q.weight; workflowDetail.push(WORKFLOW_LABELS[s]); } }
  }

  // Integration Configuration
  const INTEG_LABELS: Record<number, string> = {
    7:  "CRM system integration",
    8:  "Proposal and quoting tool integration",
    9:  "Billing/finance system integration",
    10: "External API/webhook connections",
    11: "Bi-directional sync configuration",
  };
  const integDetail: string[] = [];
  let integBase = 0;
  for (const s of [7,8,9,10,11]) {
    if (yes(s)) { const q = bySort(s); if (q) { integBase += q.weight; integDetail.push(INTEG_LABELS[s]); } }
  }
  if (connectorCount > 0) integDetail.push(`${connectorCount} push connector${connectorCount !== 1 ? "s" : ""} to ad servers/vendors`);
  const integTotal = integBase + est.connectors;

  // Financial Configuration
  const FIN_LABELS: Record<number, string> = {
    19: "Custom financial tracking (margin, COGS, reconciliation)",
    20: "Billing automation and invoice generation",
    21: "Change order workflows",
    22: "Campaign pacing data",
  };
  const finDetail: string[] = [];
  let finTotal = 0;
  for (const s of [19,20,21,22]) {
    if (yes(s)) { const q = bySort(s); if (q) { finTotal += q.weight; finDetail.push(FIN_LABELS[s]); } }
  }

  // User & Permissions
  const USER_LABELS: Record<number, string> = {
    17: "Multiple business units / brand support",
    18: "Role-based access controls and permission tiers",
  };
  const userDetail: string[] = [];
  let userTotal = 0;
  for (const s of [17,18]) {
    if (yes(s)) { const q = bySort(s); if (q) { userTotal += q.weight; userDetail.push(USER_LABELS[s]); } }
  }

  const contentSub = formTotal + workflowTotal + integTotal + finTotal + userTotal;
  const qaHrs   = Math.round(contentSub * 0.10);
  const pmHrs   = Math.round(contentSub * 0.10);
  const riskBuf = Math.max(0, est.expected - est.subtotal);

  const riskDetail = est.redFlags.length > 0
    ? est.redFlags.map((f) => f.split("—")[0].trim())
    : ["Additional hours based on implementation complexity"];

  const rows: SrdBreakdownRow[] = [];
  if (formTotal     > 0) rows.push({ label: "Form Configuration",       hours: formTotal,     detail: formDetail });
  if (workflowTotal > 0) rows.push({ label: "Workflow Configuration",    hours: workflowTotal, detail: workflowDetail });
  if (integTotal    > 0) rows.push({ label: "Integration Configuration", hours: integTotal,    detail: integDetail });
  if (finTotal      > 0) rows.push({ label: "Financial Configuration",   hours: finTotal,      detail: finDetail });
  if (userTotal     > 0) rows.push({ label: "User & Permission Setup",   hours: userTotal,     detail: userDetail });
  rows.push({ label: "QA & Testing",       hours: qaHrs, detail: ["Quality assurance across all configured items"] });
  rows.push({ label: "Program Management", hours: pmHrs, detail: ["Project oversight and implementation coordination"] });
  if (riskBuf > 0) rows.push({ label: "Risk Buffer", hours: riskBuf, detail: riskDetail });

  // ── Out of Scope ──
  const outOfScope = [
    "Active campaign or historical data migration (unless explicitly scoped above)",
    "Custom margin configuration",
    "Rate card configuration",
    "Orders reporting",
    "Training beyond UAT support",
  ];
  if (!yes(7))  outOfScope.push("CRM integration");
  if (!yes(8))  outOfScope.push("Proposal or quoting tool integration");
  if (!yes(9))  outOfScope.push("Billing or finance system integration");
  if (!yes(10)) outOfScope.push("External API or webhook connections");
  if (!yes(16)) outOfScope.push("Buy sheet or IO export configuration");

  // ── Integration Strategy ──
  let integrationStrategy: string | null = null;
  if (hasIntegrations) {
    const lines: string[] = [];
    if (yes(7))  lines.push("CRM Integration: Approach and field mapping to be defined during discovery phase.");
    if (yes(8))  lines.push("Proposal/Quoting Tool Integration: Approach to be defined during discovery phase.");
    if (yes(9))  lines.push("Billing/Finance Integration: Approach to be defined during discovery phase.");
    if (yes(10)) lines.push("External API/Webhook: Approach and data schema to be defined during discovery phase.");
    if (connectorCount > 0) lines.push(`Push Connectors (${connectorCount}): Configuration and testing included in scope.`);
    integrationStrategy = lines.join(" ");
  }

  return {
    engagement_overview: `${clientName} is implementing TapClicks AdFlo Order Management & Workflow. This engagement covers initial configuration, UAT support, and go-live preparation based on discovery completed with ${repName}.`,
    customer_objectives: objectives.length > 0 ? objectives : ["Configuration and workflow setup per discovery sessions"],
    system_architecture: arch,
    in_scope: {
      narrative: `The following configuration work is included in this engagement for ${clientName}. All items are based on discovery responses and are subject to change via the change request process.`,
      hours_breakdown: { rows, total: est.expected },
    },
    out_of_scope: outOfScope,
    integration_strategy: integrationStrategy,
    risks_and_flags: [...est.redFlags],
    meta: {
      clientName,
      repName,
      estimatedHours: est.expected,
      tier: getTier(est.expected, logic).name,
      generatedAt: new Date().toISOString(),
      generated_by: "template",
    },
  };
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
  const [activeTab, setActiveTab] = useState<"questionnaire" | "levers" | "srd" | "project">("questionnaire");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // PIN modal
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [intakeCopied, setIntakeCopied] = useState(false);

  function copyIntakeLink() {
    const url = window.location.origin + "/intake";
    navigator.clipboard.writeText(url).then(() => {
      setIntakeCopied(true);
      setTimeout(() => setIntakeCopied(false), 2000);
    }).catch(() => prompt("Copy this link:", url));
  }

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
  const [srdData, setSrdData] = useState<SrdData | null>(null);
  const [srdAiGenerating, setSrdAiGenerating] = useState(false);
  const [srdExporting, setSrdExporting] = useState(false);
  const [srdError, setSrdError] = useState<string | null>(null);

  // Share link
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<string | null>(null);
  const [shareGenerating, setShareGenerating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // ── Load questions & logic on mount ──
  useEffect(() => {
    const init = async () => {
      const [qRes, lRes] = await Promise.all([
        fetch("/api/estimator/questions"),
        fetch("/api/estimator/logic"),
      ]);
      if (qRes.ok) {
        const qData: Question[] = await qRes.json();
        setQuestions(qData);
        setQuestionsEdit(qData);
      }
      if (lRes.ok) {
        const lData: Logic = await lRes.json();
        setLogic(lData);
        setLogicEdit(lData);
      }
      setScreen("role");
    };
    init();
  }, []);

  // ── Derived values ──
  const est = useMemo(() => calcEstimate(questions, answers, logic), [questions, answers, logic]);
  const currentTier = useMemo(() => getTier(est.expected, logic), [est.expected, logic]);
  const visibleQuestions = useMemo(() => questions.filter((q) => isVisible(q, questions, answers)), [questions, answers]);
  const answeredCount = useMemo(
    () => visibleQuestions.filter((q) => answers[String(q.id)] !== undefined && answers[String(q.id)] !== "").length,
    [visibleQuestions, answers]
  );
  const categories = useMemo(() => [...new Set(visibleQuestions.map((q) => q.category))], [visibleQuestions]);
  const blockers = useMemo(() => questions.filter((q) => q.blocker && answers[String(q.id)] === q.trigger), [questions, answers]);
  const sowItems = useMemo(() => questions.filter((q) => q.sow && answers[String(q.id)] === q.trigger), [questions, answers]);
  const levers = useMemo(() => questions.filter((q) => q.can_remove && answers[String(q.id)] === q.trigger).sort((a, b) => b.weight - a.weight), [questions, answers]);
  const topLevers = levers.filter((q) => !activatedLevers.includes(q.id)).slice(0, 4);

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => (s.company_name || "").toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  const implCategoryOptions = useMemo(() =>
    [...new Set(questionsEdit.map((q) => q.impl_category).filter((c): c is string => c !== null))].sort(),
  [questionsEdit]);

  // True when displayed SRD was generated with different names than current inputs
  const srdIsStale = useMemo(() => {
    if (!srdData) return false;
    const srdClient = srdData.meta.clientName || "Client";
    const srdRep    = srdData.meta.repName    || "TapClicks Team";
    return (companyName || "Client") !== srdClient || (contactName || "TapClicks Team") !== srdRep;
  }, [srdData, companyName, contactName]);

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
    await fetch(`/api/estimator/sessions/${currentSession.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name:     companyName || "Untitled",
        primary_contact:  contactName || null,
        notes:            notes || null,
        answers,
        activated_levers: activatedLevers,
        estimated_hours:  est.expected,
        tier:             t.name,
      }),
    });
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
    const res = await fetch("/api/estimator/sessions");
    setSessions(res.ok ? await res.json() : []);
  };

  const loadHistory = async () => {
    const res = await fetch("/api/estimator/history");
    setHistory(res.ok ? await res.json() : []);
  };

  // ── Open session ──
  const openSession = async (id: string) => {
    setScreen("loading");
    const res = await fetch(`/api/estimator/sessions/${id}`);
    if (!res.ok) { setScreen("team-dashboard"); return; }
    const s: Session = await res.json();
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
      const res = await fetch("/api/estimator/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name:     newSessionName.trim(),
          primary_contact:  newSessionRep.trim() || null,
          answers:          {},
          activated_levers: [],
          estimated_hours:  logic.baseHours,
          tier:             "Bronze",
          status:           "draft",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error creating session");
      }
      const data: Session = await res.json();
      setNewSessionOpen(false);
      setNewSessionName("");
      setNewSessionRep("");
      await openSession(data.id);
    } catch (e: unknown) {
      setNewSessionError(e instanceof Error ? e.message : "Error creating session");
    } finally {
      setNewSessionSaving(false);
    }
  };

  // ── Submit as client ──
  const submitClient = async () => {
    if (!currentSession) return;
    const t = getTier(est.expected, logic);
    await fetch(`/api/estimator/sessions/${currentSession.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers,
        estimated_hours: est.expected,
        tier:            t.name,
        company_name:    companyName,
        primary_contact: contactName,
        status:          "submitted",
      }),
    });
    setScreen("complete");
  };

  // ── PIN ──
  const verifyPin = () => {
    if (pinValue === TEAM_PIN) {
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
        impl_category: null,
        question: "New question",
        trigger: "Yes",
        weight: 1,
        can_remove: false,
        blocker: false,
        sow: false,
        is_active: true,
        display_order: prev.length + 1,
        question_type: "yesno" as const,
        conditional_logic: null,
        is_risk_multiplier: false,
        risk_multiplier_value: null,
        risk_direction: null,
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

  // 1. Save logic settings
  const logicRes = await fetch("/api/estimator/logic", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(logicEdit),
  });
  if (!logicRes.ok) {
    const err = await logicRes.json();
    console.error("Logic save error:", err);
    alert(`Logic save error: ${err.error || "Unknown error"}`);
    setIsSavingLogic(false);
    return;
  }

  // 2. Reconcile questions (API deletes removed IDs then upserts remainder)
  const existingIds = questions.map((q) => q.id);
  const editedIds   = questionsEdit.map((q) => q.id);
  const deleteIds   = existingIds.filter((id) => !editedIds.includes(id));

  const questionsRes = await fetch("/api/estimator/questions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions: questionsEdit, deleteIds }),
  });
  if (!questionsRes.ok) {
    const err = await questionsRes.json();
    console.error("Questions save error:", err);
    alert(`Question save error: ${err.error || "Unknown error"}`);
    setIsSavingLogic(false);
    return;
  }

  setLogic(logicEdit);
  setQuestions(questionsEdit);
  setIsSavingLogic(false);
  alert("Logic saved");
};
  // Returns a session object with the latest name fields from current state
  const sessionWithCurrentNames = () => ({
    ...currentSession!,
    company_name:    companyName    || currentSession?.company_name    || null,
    primary_contact: contactName    || currentSession?.primary_contact || null,
  });

  // ── Generate SRD (template — instant) ──
  const runTemplateSrd = () => {
    if (!currentSession) return;
    setSrdError(null);
    setSrdData(generateTemplateSRD(sessionWithCurrentNames(), questions, logic, est));
  };

  // ── Generate SRD (AI) ──
  const generateAiSrd = async () => {
    if (!currentSession) return;
    setSrdAiGenerating(true);
    setSrdError(null);
    await persistSession();
    try {
      const res = await fetch("/api/estimator/generate-srd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSession.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg: string = data.error || "Generation failed";
        const isCreditErr = /credit|quota|billing|payment|balance|overload/i.test(errMsg);
        if (isCreditErr) {
          setSrdError("AI generation requires API credits. Using template generation instead.");
          setSrdData(generateTemplateSRD(sessionWithCurrentNames(), questions, logic, est));
        } else {
          setSrdError(errMsg);
        }
        return;
      }
      setSrdData(data as SrdData);
    } catch (e: unknown) {
      setSrdError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setSrdAiGenerating(false);
    }
  };

  const exportSrd = async () => {
    if (!srdData) return;
    setSrdExporting(true);
    try {
      const res = await fetch("/api/estimator/export-srd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(srdData),
      });
      if (!res.ok) { alert("Export failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = srdData.meta?.clientName || "Client";
      a.href = url;
      a.download = `SRD-${name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setSrdExporting(false);
    }
  };

  // ── Generate share link ──
  const generateShareLink = async () => {
    if (!currentSession) return;
    setShareGenerating(true);
    try {
      const res = await fetch("/api/estimator/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSession.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setShareLink(data.url);
        setShareExpiry(data.expiresAt ?? null);
        setShareCopied(false);
        setShareModalOpen(true);
      }
    } finally {
      setShareGenerating(false);
    }
  };

  // ── Start client flow ──
  const startClientFlow = async () => {
    setScreen("loading");
    const res = await fetch("/api/estimator/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name:     "",
        answers:          {},
        activated_levers: [],
        estimated_hours:  logic.baseHours,
        tier:             "Bronze",
        status:           "draft",
      }),
    });
    if (!res.ok) { setScreen("role"); return; }
    const data: Session = await res.json();
    setCurrentSession(data);
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
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <RoleCard icon="📋" title="Client / Sales" desc="Answer the onboarding questionnaire to help us understand your needs." onClick={startClientFlow} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); copyIntakeLink(); }}
              style={{
                width: "100%",
                padding: "9px 16px",
                borderRadius: 10,
                border: "1px solid #cddcff",
                background: intakeCopied ? "#edf8f2" : "#eaf1ff",
                color: intakeCopied ? "#1f9d55" : "#2f6fed",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {intakeCopied ? "✓ Link copied!" : "🔗 Share Intake Link"}
            </button>
          </div>
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
              const qs = visibleQuestions.filter((q) => q.category === cat);
              const done = qs.filter((q) => answers[String(q.id)] !== undefined && answers[String(q.id)] !== "").length;
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
              {visibleQuestions.filter((q) => q.category === cat).map((q) => {
                const a = answers[String(q.id)] ?? "";
                const hasAnswer = a !== "";
                return (
                  <div key={q.id} style={{ background: hasAnswer ? "#f6fbf8" : "#fff", border: `1px solid ${hasAnswer ? "#cfe7d7" : "#dde5ef"}`, borderRadius: 14, padding: "16px 18px", marginBottom: 10, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04)", transition: "all 0.15s" }}>
                    <div style={{ fontSize: 14, color: "#0f1623", lineHeight: 1.55, fontWeight: 500 }}>{q.question}</div>
                    <div>
                      {q.question_type === "number" && (
                        <input type="number" min={0} value={a} onChange={(e) => setAnswer(q.id, e.target.value)}
                          placeholder="0"
                          style={{ width: 80, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #dde5ef", fontSize: 15, fontWeight: 600, fontFamily: "inherit", textAlign: "center", outline: "none", background: "#f8fafc" }} />
                      )}
                      {q.question_type === "date" && (
                        <input type="date" value={a} onChange={(e) => setAnswer(q.id, e.target.value)}
                          style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid #dde5ef", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#f8fafc" }} />
                      )}
                      {q.question_type === "yesno" && (
                        <div style={{ display: "flex", gap: 8 }}>
                          {["Yes", "No"].map((opt) => (
                            <button key={opt} type="button" onClick={() => setAnswer(q.id, opt)}
                              style={{ padding: "8px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#dde5ef"}`, background: a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#f8fafc", color: a === opt ? "#fff" : "#627286", transition: "all 0.15s", fontFamily: "inherit" }}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
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
                {[{ label: "Base Hours", key: "baseHours", unit: "hrs" }, { label: "Best Case", key: "bestCaseMultiplier", unit: "×" }, { label: "Worst Case", key: "worstCaseMultiplier", unit: "×" }, { label: "Product Rate", key: "productHourRate", unit: "hrs" }, { label: "Connector Rate", key: "connectorHourRate", unit: "hrs" }].map(({ label, key, unit }) => (
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

            {/* Risk Multipliers panel */}
            <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Risk Multipliers</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>{["Question", "Trigger", "Multiplier"].map((h) => <th key={h} style={{ ...thStyle, padding: "6px 8px" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(logicEdit.riskMultipliers ?? []).map((rm, i) => {
                    const q = questionsEdit.find((x) => x.display_order === rm.sort_order);
                    const pct = Math.round((rm.multiplier - 1) * 100);
                    return (
                      <tr key={rm.sort_order}>
                        <td style={{ padding: "8px 8px", color: "#455468", maxWidth: 360 }}>
                          {q ? q.question : `Sort order ${rm.sort_order}`}
                          {rm.sort_order === 26 && <span style={{ marginLeft: 6, fontSize: 10, color: "#8a9bb0" }}>(only when integrations in scope)</span>}
                        </td>
                        <td style={{ padding: "8px 8px", color: "#8a9bb0", whiteSpace: "nowrap" }}>if {rm.condition}</td>
                        <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                          <input
                            type="number"
                            step="0.01"
                            min="1"
                            max="2"
                            value={rm.multiplier}
                            onChange={(e) => setLogicEdit((prev) => {
                              const rms = [...(prev.riskMultipliers ?? [])];
                              rms[i] = { ...rms[i], multiplier: parseFloat(e.target.value) || 1 };
                              return { ...prev, riskMultipliers: rms };
                            })}
                            style={{ ...logicInputStyle, width: 72 }}
                          />
                          <span style={{ fontSize: 11, color: pct > 0 ? "#b7791f" : "#8a9bb0", marginLeft: 6 }}>
                            {pct > 0 ? "+" : ""}{pct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                  <thead><tr style={{ background: "#f8fafc" }}>{["#", "", "Category", "Question", "Trigger", "Wt", "Impl. Category", "Removable", "Blocker", "SOW", "Risk ×", ""].map((h) => <th key={h} style={{ ...thStyle, padding: "8px 12px" }}>{h}</th>)}</tr></thead>
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
                        <td style={{ padding: "8px 12px" }}>
  <select
    value={q.impl_category ?? ""}
    onChange={(e) => updateQuestionField(i, "impl_category", e.target.value || null)}
    style={{ fontSize: 12, padding: "3px 4px", maxWidth: 160 }}
  >
    <option value="">—</option>
    {implCategoryOptions.map((cat) => (
      <option key={cat} value={cat}>{cat}</option>
    ))}
  </select>
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
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
  <input type="checkbox" checked={q.is_risk_multiplier} readOnly style={{ cursor: "default", opacity: 0.7 }} />
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
              <span>{answeredCount}/{visibleQuestions.length}</span>
            </div>
            {/* Hours breakdown */}
            <div style={{ marginTop: 12, display: "grid", gap: 3 }}>
              {[
                { label: "Base",       value: est.base },
                { label: "Products",   value: est.products },
                { label: "Connectors", value: est.connectors },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8a9bb0" }}>
                  <span>{label}</span><span>{value} hrs</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#455468", fontWeight: 600, borderTop: "1px solid #dde5ef", paddingTop: 3, marginTop: 2 }}>
                <span>Subtotal</span><span>{est.subtotal} hrs</span>
              </div>
              {est.multiplier > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#b7791f", fontWeight: 700 }}>
                  <span>Risk ×</span><span>{est.multiplier.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Red flags */}
          {est.redFlags.length > 0 && (
            <div style={{ padding: "12px 16px", background: "#fff8e8", borderBottom: "1px solid #f3e0a3" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>⚠️ Risk Flags</div>
              {est.redFlags.map((flag, i) => (
                <div key={i} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4, lineHeight: 1.4 }}>• {flag}</div>
              ))}
            </div>
          )}

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
            {(["questionnaire", "levers", "srd", "project"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{ ...tabStyle, ...(activeTab === t ? activeTabStyle : {}) }}>
                {t === "questionnaire" ? "Questionnaire" : t === "levers" ? "🎛 Levers" : t === "srd" ? "📄 SRD" : "🏗 Project"}
              </button>
            ))}
            <button
              onClick={generateShareLink}
              disabled={shareGenerating}
              style={{ marginLeft: "auto", padding: "7px 14px", borderRadius: 10, border: "1px solid #cddcff", background: "#eaf1ff", color: "#2f6fed", fontWeight: 700, cursor: shareGenerating ? "default" : "pointer", fontSize: 12.5, fontFamily: "inherit" }}>
              {shareGenerating ? "Generating…" : "🔗 Share with Client"}
            </button>
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
                    {visibleQuestions.filter((q) => q.category === cat).map((q) => {
                      const a = answers[String(q.id)] ?? "";
                      const triggered = q.question_type === "yesno" ? a === q.trigger : a !== "";
                      const levered = activatedLevers.includes(q.id);
                      return (
                        <div key={q.id} style={{ background: triggered ? "#eaf1ff" : "#fff", border: `1px solid ${triggered ? "#cddcff" : "#dde5ef"}`, borderRadius: 14, padding: "16px 18px", marginBottom: 10, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 14, color: "#0f1623", lineHeight: 1.55, fontWeight: 500 }}>{q.question}</div>
                            <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                              {q.weight > 0 && <span>{q.weight} hrs</span>}
                              {q.is_risk_multiplier && a === "Yes" && (
                                <span style={{ color: "#1f9d55", fontWeight: 700 }}>✓ no risk</span>
                              )}
                              {q.is_risk_multiplier && a === "No" && (
                                <span style={{ color: "#b7791f", fontWeight: 700 }}>⚠ risk ×{q.risk_multiplier_value}</span>
                              )}
                              {q.is_risk_multiplier && a !== "Yes" && a !== "No" && (
                                <span style={{ color: "#8a9bb0" }}>risk ×{q.risk_multiplier_value}</span>
                              )}
                              {q.question_type === "date" && a && new Date(a) < new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000) && (
                                <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠ aggressive timeline</span>
                              )}
                              {triggered && q.weight > 0 && <span style={{ color: "#2f6fed", fontWeight: 700 }}>↑ adds hours</span>}
                              {q.blocker && triggered && <span style={{ color: "#dc2626", fontWeight: 700 }}>🔴 Blocker</span>}
                              {q.sow && triggered && <span style={{ color: "#b7791f", fontWeight: 700 }}>📋 SOW</span>}
                              {levered && <span style={{ color: "#1f9d55", fontWeight: 700 }}>✓ Levered out</span>}
                            </div>
                          </div>
                          <div>
                            {q.question_type === "number" && (
                              <input type="number" min={0} value={a} onChange={(e) => setAnswer(q.id, e.target.value)}
                                placeholder="0"
                                style={{ width: 80, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #dde5ef", fontSize: 15, fontWeight: 600, fontFamily: "inherit", textAlign: "center", outline: "none", background: "#f8fafc" }} />
                            )}
                            {q.question_type === "date" && (
                              <input type="date" value={a} onChange={(e) => setAnswer(q.id, e.target.value)}
                                style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid #dde5ef", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#f8fafc" }} />
                            )}
                            {q.question_type === "yesno" && (
                              <div style={{ display: "flex", gap: 8 }}>
                                {["Yes", "No"].map((opt) => (
                                  <button key={opt} type="button" onClick={() => setAnswer(q.id, opt)}
                                    style={{ padding: "8px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#dde5ef"}`, background: a === opt ? (opt === "Yes" ? "#1f9d55" : "#c94b4b") : "#f8fafc", color: a === opt ? "#fff" : "#627286", fontFamily: "inherit" }}>
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            )}
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
                {/* Header row */}
                <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f1623", marginBottom: 6 }}>SRD Generator</h2>
                    <p style={{ fontSize: 14, color: "#627286" }}>
                      {srdData
                        ? <>
                            {srdData.meta.generated_by === "ai"
                              ? <span style={{ background: "#eaf1ff", color: "#2f6fed", borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700, marginRight: 6 }}>AI</span>
                              : <span style={{ background: "#f0f4f9", color: "#627286", borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700, marginRight: 6 }}>Template</span>
                            }
                            {new Date(srdData.meta.generatedAt).toLocaleString()} · {srdData.meta.estimatedHours} hrs · {srdData.meta.tier}
                          </>
                        : "Generate a full SRD instantly from questionnaire answers, or use AI for richer narrative content."}
                    </p>
                    {srdIsStale && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#8a6417", display: "flex", alignItems: "center", gap: 5 }}>
                        <span>↻</span>
                        <span>Client name changed — regenerate to update</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
                    <button onClick={runTemplateSrd} disabled={!currentSession} style={outlineBtnStyle}>
                      {srdData ? "Re-generate" : "Generate SRD"}
                    </button>
                    <button onClick={generateAiSrd} disabled={srdAiGenerating || !currentSession}
                      style={{ ...primaryBtnStyle, background: srdAiGenerating ? "#8a9bb0" : "#2f6fed" }}>
                      {srdAiGenerating ? "Generating with AI…" : "✨ Generate with AI"}
                    </button>
                    {srdData && (
                      <button onClick={exportSrd} disabled={srdExporting} style={outlineBtnStyle}>
                        {srdExporting ? "Exporting…" : "Export to Word"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Error / fallback message */}
                {srdError && (
                  <div style={{ marginBottom: 20, padding: "14px 18px", background: srdData ? "#fff8e8" : "#fee2e2", border: `1px solid ${srdData ? "#f3e0a3" : "#fca5a5"}`, borderRadius: 12, color: srdData ? "#8a6417" : "#991b1b", fontSize: 13 }}>
                    {srdError}
                  </div>
                )}

                {/* Empty state */}
                {!srdData && !srdAiGenerating && (
                  <div style={{ padding: "64px 0", textAlign: "center", color: "#8a9bb0" }}>
                    <div style={{ fontSize: 36, marginBottom: 16 }}>📄</div>
                    <div style={{ fontWeight: 700, color: "#455468", marginBottom: 8, fontSize: 16 }}>No SRD generated yet</div>
                    <div style={{ fontSize: 14, marginBottom: 24 }}>
                      Answer the questionnaire, then generate your SRD — template is instant, AI adds richer narrative.
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      <button onClick={runTemplateSrd} disabled={!currentSession} style={outlineBtnStyle}>Generate SRD</button>
                      <button onClick={generateAiSrd} disabled={srdAiGenerating || !currentSession} style={primaryBtnStyle}>✨ Generate with AI</button>
                    </div>
                  </div>
                )}

                {/* AI loading skeleton */}
                {srdAiGenerating && (
                  <div style={{ padding: "48px 0", textAlign: "center" }}>
                    <div style={spinnerStyle} />
                    <div style={{ marginTop: 16, fontSize: 14, color: "#627286" }}>Calling Claude to generate SRD…</div>
                  </div>
                )}

                {/* SRD content */}
                {srdData && !srdAiGenerating && (
                  <div style={{ display: "grid", gap: 18 }}>

                    {/* Risks banner */}
                    {srdData.risks_and_flags.length > 0 && (
                      <div style={{ background: "#fff8e8", border: "1px solid #f3e0a3", borderRadius: 16, padding: "16px 20px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>⚠️ Risks & Scope Flags</div>
                        {srdData.risks_and_flags.map((r, i) => (
                          <div key={i} style={{ fontSize: 13, color: "#8a6417", paddingLeft: 14, position: "relative", marginBottom: 6 }}>
                            <span style={{ position: "absolute", left: 0 }}>•</span>{r}
                          </div>
                        ))}
                      </div>
                    )}

                    <SrdSection title="Engagement Overview">
                      <p style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, margin: 0 }}>{srdData.engagement_overview}</p>
                    </SrdSection>

                    <SrdSection title="Customer Objectives">
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {srdData.customer_objectives.map((obj, i) => (
                          <li key={i} style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, marginBottom: 4 }}>{obj}</li>
                        ))}
                      </ul>
                    </SrdSection>

                    <SrdSection title="System Architecture">
                      <p style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, margin: 0 }}>{srdData.system_architecture}</p>
                    </SrdSection>

                    <SrdSection title="In Scope">
                      <p style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, marginBottom: 18 }}>{srdData.in_scope.narrative}</p>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Hours Breakdown</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: "#1f3a6e" }}>
                            {["Category", "Hours", "Details"].map((h) => (
                              <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#fff", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {srdData.in_scope.hours_breakdown.rows.map((row, i) => (
                            <tr key={row.label} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", fontWeight: 500, color: "#0f1623" }}>{row.label}</td>
                              <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#2f6fed", whiteSpace: "nowrap" }}>{row.hours} hrs</td>
                              <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", color: "#627286", fontSize: 12 }}>{row.detail.join(" · ")}</td>
                            </tr>
                          ))}
                          <tr style={{ background: "#eaf1ff" }}>
                            <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1f3a6e" }}>TOTAL</td>
                            <td style={{ padding: "10px 14px", fontWeight: 800, color: "#1f3a6e", fontVariantNumeric: "tabular-nums" }}>{srdData.in_scope.hours_breakdown.total} hrs</td>
                            <td style={{ padding: "10px 14px" }}></td>
                          </tr>
                        </tbody>
                      </table>
                    </SrdSection>

                    <SrdSection title="Out of Scope">
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {srdData.out_of_scope.map((item, i) => (
                          <li key={i} style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, marginBottom: 4 }}>{item}</li>
                        ))}
                      </ul>
                    </SrdSection>

                    {srdData.integration_strategy && (
                      <SrdSection title="Integration Strategy">
                        <p style={{ fontSize: 14, color: "#455468", lineHeight: 1.7, margin: 0 }}>{srdData.integration_strategy}</p>
                      </SrdSection>
                    )}

                    {/* Export CTA */}
                    <div style={{ display: "flex", gap: 12, paddingTop: 8 }}>
                      <button onClick={exportSrd} disabled={srdExporting} style={primaryBtnStyle}>
                        {srdExporting ? "Exporting…" : "Export to Word (.docx)"}
                      </button>
                      <button onClick={runTemplateSrd} style={outlineBtnStyle}>Re-generate</button>
                      <button onClick={generateAiSrd} disabled={srdAiGenerating} style={outlineBtnStyle}>
                        ✨ Re-generate with AI
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Project tab */}
            {activeTab === "project" && (
              currentSession
                ? <ProjectTab sessionId={currentSession.id} estimatedHours={currentSession.estimated_hours} />
                : (
                  <div style={{ padding: "64px 0", textAlign: "center", color: "#8a9bb0" }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>🏗️</div>
                    <div style={{ fontWeight: 700, color: "#455468", marginBottom: 8, fontSize: 16 }}>No session loaded</div>
                    <div style={{ fontSize: 14 }}>Save the questionnaire first to start a project.</div>
                  </div>
                )
            )}
          </div>
        </div>

        {/* Share modal */}
        {shareModalOpen && shareLink && (
          <ModalOverlay onClose={() => { setShareModalOpen(false); setShareCopied(false); }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623", marginBottom: 6 }}>Share with Client</div>
            <div style={{ fontSize: 13, color: "#627286", marginBottom: 14 }}>
              Send this link to {companyName || "the client"}. They can fill out the questionnaire directly — no account required.
            </div>
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, color: "#92400e", marginBottom: 14, lineHeight: 1.55 }}>
              ⚠ Client answers will update this session directly.
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 12, padding: "12px 14px", fontSize: 12.5, color: "#455468", wordBreak: "break-all", marginBottom: 8, fontFamily: "'DM Mono', monospace", lineHeight: 1.5 }}>
              {shareLink}
            </div>
            {shareExpiry && (
              <div style={{ fontSize: 12, color: "#8a9bb0", marginBottom: 14 }}>
                Link expires {new Date(shareExpiry).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { navigator.clipboard.writeText(shareLink); setShareCopied(true); }}
                style={{ ...primaryBtnStyle, flex: 1, background: shareCopied ? "#1f9d55" : "#2f6fed" }}>
                {shareCopied ? "✓ Copied!" : "Copy Link"}
              </button>
              <button onClick={() => { setShareModalOpen(false); setShareCopied(false); }} style={outlineBtnStyle}>Close</button>
            </div>
          </ModalOverlay>
        )}
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

function SrdSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #dde5ef", fontSize: 12, fontWeight: 700, color: "#1f3a6e", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {title}
      </div>
      <div style={{ padding: "18px 20px" }}>{children}</div>
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
