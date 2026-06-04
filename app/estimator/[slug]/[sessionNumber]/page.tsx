"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProjectTab from "../../sessions/[id]/ProjectTab";
import { supabase } from "../../../../lib/supabase";

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
  question_type: "yesno" | "number" | "date" | "multiplechoice";
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
  transcript?: Array<{ role: string; content: string }> | null;
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

type SrdBreakdownRow = { category: string; hours: number; details: string };

type SrdData = {
  engagement_overview: string;
  customer_objectives: string[];
  system_architecture: string;
  in_scope: {
    narrative: string;
    hours_breakdown: SrdBreakdownRow[];
    total_hours: number;
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

// ─── Constants ─────────────────────────────────────────────────────────────

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

function isVisible(q: Question, allQuestions: Question[], answers: Record<string, string>): boolean {
  const cl = q.conditional_logic;
  if (!cl) return true;
  const bySort = (n: number) => allQuestions.find((x) => x.display_order === n);
  const isAnsweredYesOrNonzero = (dep: Question) => {
    const a = answers[String(dep.id)];
    if (dep.question_type === "number") return parseInt(a || "0", 10) > 0;
    if (dep.question_type === "multiplechoice") return a !== "" && a !== undefined;
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
    if (dep.question_type === "multiplechoice") return (answers[String(dep.id)] ?? "") !== "";
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

  let base = 0;
  for (const q of questions) {
    if (q.question_type === "yesno" && !q.is_risk_multiplier && answers[String(q.id)] === "Yes") {
      base += q.weight;
    }
  }

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

  const q12 = bySort(12);
  let connectors = 0;
  if (q12) {
    const count = parseInt(answers[String(q12.id)] || "0", 10) || 0;
    connectors = count * (logic.connectorHourRate ?? 12);
  }

  const subtotal = base + products + connectors;

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

  const redFlags: string[] = [];
  const q23 = bySort(23); const q24 = bySort(24);
  const q25 = bySort(25); const q26 = bySort(26);
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
    base, products, connectors, subtotal, multiplier, expected,
    best:  Math.round(expected * (logic.bestCaseMultiplier ?? 0.8)),
    worst: Math.round(expected * (logic.worstCaseMultiplier ?? 1.3)),
    redFlags,
  };
}

function getTierStyle(tierName: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 };
  if (tierName === "Bronze") return { ...base, background: "#fdf1e5", color: "#a8611a", border: "1px solid #f1d3b2" };
  if (tierName === "Silver") return { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #dbe3ec" };
  if (tierName === "Gold")   return { ...base, background: "#fff7db", color: "#9a6b00", border: "1px solid #f1dd8c" };
  return { ...base, background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" };
}

function generateTemplateSRD(
  session: Session,
  questions: Question[],
  logic: Logic,
  est: EstResult,
): SrdData {
  const clientName = session.company_name || "Client";
  const repName    = session.primary_contact || "AdFlo Team";
  const answers    = session.answers || {};

  const bySort = (n: number) => questions.find((q) => q.display_order === n);
  const yes    = (n: number) => { const q = bySort(n); return q ? answers[String(q.id)] === "Yes" : false; };
  const num    = (n: number) => { const q = bySort(n); return q ? parseInt(answers[String(q.id)] || "0", 10) || 0 : 0; };

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

  const productCount    = num(13);
  const hasFlight       = yes(14);
  const connectorCount  = num(12);
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
    if (yes(7))            parts.push("CRM system");
    if (yes(8))            parts.push("proposal/quoting tools");
    if (yes(9))            parts.push("billing/finance systems");
    if (yes(10))           parts.push("external API/webhook connections");
    if (yes(11))           parts.push("bi-directional sync");
    if (connectorCount > 0) parts.push(`${connectorCount} push connector${connectorCount !== 1 ? "s" : ""}`);
    if (parts.length)      arch += `Integration connections include: ${parts.join(", ")}.`;
  }

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
  if (formTotal     > 0) rows.push({ category: "Form Configuration",       hours: formTotal,     details: formDetail.join(" · ") });
  if (workflowTotal > 0) rows.push({ category: "Workflow Configuration",    hours: workflowTotal, details: workflowDetail.join(" · ") });
  if (integTotal    > 0) rows.push({ category: "Integration Configuration", hours: integTotal,    details: integDetail.join(" · ") });
  if (finTotal      > 0) rows.push({ category: "Financial Configuration",   hours: finTotal,      details: finDetail.join(" · ") });
  if (userTotal     > 0) rows.push({ category: "User & Permission Setup",   hours: userTotal,     details: userDetail.join(" · ") });
  rows.push({ category: "QA & Testing",       hours: qaHrs, details: "Quality assurance across all configured items" });
  rows.push({ category: "Program Management", hours: pmHrs, details: "Project oversight and implementation coordination" });
  if (riskBuf > 0) rows.push({ category: "Risk Buffer", hours: riskBuf, details: riskDetail.join(" · ") });

  const outOfScope = [
    "Active campaign or historical data migration (unless explicitly scoped above)",
    "Orders reporting",
    "Training beyond UAT support",
  ];
  if (!yes(7))  outOfScope.push("CRM integration");
  if (!yes(8))  outOfScope.push("Proposal or quoting tool integration");
  if (!yes(9))  outOfScope.push("Billing or finance system integration");
  if (!yes(10)) outOfScope.push("External API or webhook connections");
  if (!yes(16)) outOfScope.push("Buy sheet or IO export configuration");

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
    engagement_overview: `${clientName} is implementing AdFlo Order Management & Workflow. This engagement covers initial configuration, UAT support, and go-live preparation based on discovery completed with ${repName}.`,
    customer_objectives: objectives.length > 0 ? objectives : ["Configuration and workflow setup per discovery sessions"],
    system_architecture: arch,
    in_scope: {
      narrative: `The following configuration work is included in this engagement for ${clientName}. All items are based on discovery responses and are subject to change via the change request process.`,
      hours_breakdown: rows,
      total_hours: est.expected,
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

// ─── Sub-components ─────────────────────────────────────────────────────────

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
const spinnerStyle: React.CSSProperties = { width: 32, height: 32, border: "3px solid #dde5ef", borderTopColor: "#2f6fed", borderRadius: "50%", animation: "spin 0.7s linear infinite" };

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SessionPage() {
  const { slug, sessionNumber } = useParams<{ slug: string; sessionNumber: string }>();
  const router = useRouter();

  const clientNameFromSlug = slug
    ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  const [questions, setQuestions] = useState<Question[]>([]);
  const [logic, setLogic] = useState<Logic>(DEFAULT_LOGIC);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activatedLevers, setActivatedLevers] = useState<number[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const [activeTab, setActiveTab] = useState<"questionnaire" | "levers" | "srd" | "project">("questionnaire");

  const [srdData, setSrdData] = useState<SrdData | null>(null);
  const [srdAiGenerating, setSrdAiGenerating] = useState(false);
  const [srdExporting, setSrdExporting] = useState(false);
  const [srdError, setSrdError] = useState<string | null>(null);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<string | null>(null);
  const [shareGenerating, setShareGenerating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Load questions, logic, and session on mount
  useEffect(() => {
    if (!slug || !sessionNumber) return;
    const init = async () => {
      const [qRes, lRes, sRes] = await Promise.all([
        fetch("/api/estimator/questions"),
        fetch("/api/estimator/logic"),
        fetch(`/api/estimator/sessions?slug=${encodeURIComponent(slug)}&session_number=${encodeURIComponent(sessionNumber)}`),
      ]);
      if (qRes.ok) setQuestions(await qRes.json());
      if (lRes.ok) setLogic(await lRes.json());
      if (sRes.ok) {
        const s: Session = await sRes.json();
        setCurrentSession(s);
        setAnswers(s.answers || {});
        setActivatedLevers(s.activated_levers || []);
        setCompanyName(s.company_name || "");
        setContactName(s.primary_contact || "");
      } else {
        router.push("/estimator");
        return;
      }
      setLoading(false);
    };
    init();
  }, [slug, sessionNumber, router]);

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

  const srdIsStale = useMemo(() => {
    if (!srdData) return false;
    const srdClient = srdData.meta.clientName || "Client";
    const srdRep    = srdData.meta.repName    || "AdFlo Team";
    return (companyName || "Client") !== srdClient || (contactName || "AdFlo Team") !== srdRep;
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

  const sessionWithCurrentNames = () => ({
    ...currentSession!,
    company_name:    companyName    || currentSession?.company_name    || null,
    primary_contact: contactName    || currentSession?.primary_contact || null,
  });

  const runTemplateSrd = () => {
    if (!currentSession) return;
    setSrdError(null);
    setSrdData(generateTemplateSRD(sessionWithCurrentNames(), questions, logic, est));
  };

  const generateAiSrd = async () => {
    if (!currentSession) return;
    setSrdAiGenerating(true);
    setSrdError(null);
    await persistSession();
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const res = await fetch("/api/estimator/generate-srd", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
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

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 60px)" }}>
        <div style={spinnerStyle} />
      </div>
    );
  }

  if (!currentSession) return null;

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>

      {/* Sidebar */}
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

        {est.redFlags.length > 0 && (
          <div style={{ padding: "12px 16px", background: "#fff8e8", borderBottom: "1px solid #f3e0a3" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>⚠️ Risk Flags</div>
            {est.redFlags.map((flag, i) => (
              <div key={i} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4, lineHeight: 1.4 }}>• {flag}</div>
            ))}
          </div>
        )}

        <div style={{ padding: "14px 16px", borderBottom: "1px solid #dde5ef" }}>
          <div style={{ fontSize: 11, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Top Levers</div>
          {topLevers.length > 0 ? topLevers.map((q) => (
            <div key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #e8edf4", fontSize: 12 }}>
              <span style={{ color: "#455468" }}>{q.lever_name || q.question.slice(0, 30)}</span>
              <button onClick={() => toggleLever(q.id)} style={{ color: "#1f9d55", fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>−{q.weight}h</button>
            </div>
          )) : <div style={{ fontSize: 12, color: "#8a9bb0" }}>No removable items triggered yet</div>}
        </div>

        {(blockers.length > 0 || sowItems.length > 0) && (
          <div style={{ padding: "12px 16px", background: "#fff8e8", borderBottom: "1px solid #f3e0a3" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>⚠️ Scope Flags</div>
            {blockers.map((q) => <div key={q.id} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4 }}>🔴 {q.question.slice(0, 45)}…</div>)}
            {sowItems.map((q)  => <div key={q.id} style={{ fontSize: 11, color: "#8a6417", marginBottom: 4 }}>📋 {q.question.slice(0, 45)}…</div>)}
          </div>
        )}

        <div style={{ padding: "14px 16px", marginTop: "auto", borderTop: "1px solid #dde5ef" }}>
          {saveStatus && <div style={{ fontSize: 11, color: saveStatus === "saved" ? "#1f9d55" : "#8a9bb0", marginBottom: 8 }}>{saveStatus === "saving" ? "Saving…" : "✓ Saved"}</div>}
          <button
            onClick={async () => { await persistSession(); router.push("/estimator"); }}
            style={{ ...outlineBtnStyle, width: "100%", textAlign: "center" }}>
            ← Sessions
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Breadcrumb */}
        <div style={{ padding: "10px 24px 0", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a9bb0" }}>
          <Link href="/estimator" style={{ color: "#627286", textDecoration: "none" }}>Sessions</Link>
          <span>›</span>
          <span style={{ color: "#0f1623", fontWeight: 600 }}>{companyName || clientNameFromSlug}</span>
        </div>
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
                            {q.weight > 0 && a !== "" && <span>{q.weight} hrs</span>}
                            {q.is_risk_multiplier && a === "Yes" && (
                              <span style={{ color: "#1f9d55", fontWeight: 700 }}>✓ no risk</span>
                            )}
                            {q.is_risk_multiplier && a === "No" && (
                              <span style={{ color: "#b7791f", fontWeight: 700 }}>⚠ risk ×{q.risk_multiplier_value}</span>
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
                          {q.question_type === "multiplechoice" && (
                            <div style={{ display: "flex", gap: 8 }}>
                              {[{ val: "1-5", label: "1–5 products" }, { val: "6-10", label: "6–10 products" }, { val: "11-15", label: "11–15 products" }].map(({ val, label }) => (
                                <button key={val} type="button" onClick={() => setAnswer(q.id, val)}
                                  style={{ padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a === val ? "#1f9d55" : "#dde5ef"}`, background: a === val ? "#1f9d55" : "#f8fafc", color: a === val ? "#fff" : "#627286", transition: "all 0.15s", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                                  {label}
                                </button>
                              ))}
                            </div>
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
              <button onClick={() => persistSession()} style={primaryBtnStyle}>💾 Save</button>
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

              {srdError && (
                <div style={{ marginBottom: 20, padding: "14px 18px", background: srdData ? "#fff8e8" : "#fee2e2", border: `1px solid ${srdData ? "#f3e0a3" : "#fca5a5"}`, borderRadius: 12, color: srdData ? "#8a6417" : "#991b1b", fontSize: 13 }}>
                  {srdError}
                </div>
              )}

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

              {srdAiGenerating && (
                <div style={{ padding: "48px 0", textAlign: "center" }}>
                  <div style={spinnerStyle} />
                  <div style={{ marginTop: 16, fontSize: 14, color: "#627286" }}>Calling Claude to generate SRD…</div>
                </div>
              )}

              {srdData && !srdAiGenerating && (
                <div style={{ display: "grid", gap: 18 }}>
                  {srdData.risks_and_flags.length > 0 && (
                    <div style={{ background: "#fff8e8", border: "1px solid #f3e0a3", borderRadius: 16, padding: "16px 20px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6417", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>⚠️ Risks & Scope Flags</div>
                      {srdData.risks_and_flags.map((r, i) => {
                        const text = typeof r === "string" ? r : (r as { flag?: string; detail?: string }).flag ?? JSON.stringify(r);
                        return (
                          <div key={i} style={{ fontSize: 13, color: "#8a6417", paddingLeft: 14, position: "relative", marginBottom: 6 }}>
                            <span style={{ position: "absolute", left: 0 }}>•</span>{text}
                          </div>
                        );
                      })}
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
                        {srdData.in_scope.hours_breakdown.map((row, i) => (
                          <tr key={row.category} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                            <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", fontWeight: 500, color: "#0f1623" }}>{row.category}</td>
                            <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#2f6fed", whiteSpace: "nowrap" }}>{row.hours} hrs</td>
                            <td style={{ padding: "10px 14px", borderBottom: "1px solid #edf2f7", color: "#627286", fontSize: 12 }}>{row.details}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "#eaf1ff" }}>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1f3a6e" }}>TOTAL</td>
                          <td style={{ padding: "10px 14px", fontWeight: 800, color: "#1f3a6e", fontVariantNumeric: "tabular-nums" }}>{srdData.in_scope.total_hours} hrs</td>
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
            <ProjectTab sessionId={currentSession.id} estimatedHours={currentSession.estimated_hours} />
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
