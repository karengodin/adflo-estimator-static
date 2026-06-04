type QuestionRow = {
  id: number;
  impl_category: string | null;
  weight: number | null;
  question_type: string;
  is_risk_multiplier: boolean | null;
  risk_multiplier_value: number | null;
  sort_order: number;
};

type LogicSettings = {
  product_hour_rate?: number | null;
  connector_hour_rate?: number | null;
  risk_multipliers?: Array<{ sort_order: number; condition: string; multiplier: number }> | null;
};

export type EstimateBreakdown = {
  formConfiguration: number;
  workflowConfiguration: number;
  integrationConfiguration: number;
  financialConfiguration: number;
  userPermissions: number;
  qaAndTesting: number;
  uatSupport: number;
  programManagement: number;
  riskBuffer: number;
  total: number;
};

export function calcEstimateFromAnswers(
  answers: Record<string, string>,
  questions: QuestionRow[],
  logicSettings: LogicSettings
): EstimateBreakdown {
  const bySort = (n: number) => questions.find((q) => q.sort_order === n);
  const connectorHourRate = logicSettings.connector_hour_rate ?? 12;

  const hours: Record<string, number> = {};
  const add = (cat: string | null | undefined, h: number) => {
    if (!cat || h <= 0) return;
    hours[cat] = (hours[cat] ?? 0) + h;
  };

  // yesno non-risk questions answered "Yes" → accumulate by impl_category
  for (const q of questions) {
    if (q.is_risk_multiplier || q.question_type !== "yesno") continue;
    if (answers[String(q.id)] === "Yes") add(q.impl_category, q.weight ?? 0);
  }

  // Product hours → Form Configuration (Q13 = product tier)
  const q13 = bySort(13);
  if (q13) {
    const ans = answers[String(q13.id)];
    if (ans === "1-5")   add("Form Configuration", 20);
    else if (ans === "6-10")  add("Form Configuration", 40);
    else if (ans === "11-15") add("Form Configuration", 60);
  }

  // Connector hours → Integration Configuration (Q12 = push connector count)
  const q12 = bySort(12);
  if (q12) {
    const count = parseInt(answers[String(q12.id)] || "0", 10) || 0;
    add("Integration Configuration", count * connectorHourRate);
  }

  // Subtotal before risk multipliers
  const subtotal = Object.values(hours).reduce((s, v) => s + v, 0);

  // Org-readiness risk multipliers (stacked multiplicatively)
  const hasIntegrations = questions
    .filter((q) => q.sort_order >= 7 && q.sort_order <= 12)
    .some((q) => {
      const a = answers[String(q.id)];
      return q.question_type === "number" ? parseInt(a || "0", 10) > 0 : a === "Yes";
    });

  const riskMultipliers = (
    (logicSettings.risk_multipliers as Array<{ sort_order?: number; question_id?: number; condition: string; multiplier: number }> | null | undefined)
      ?.map((rm) => ({ sort_order: rm.sort_order ?? rm.question_id ?? 0, condition: rm.condition, multiplier: rm.multiplier }))
  ) ?? [
    { sort_order: 23, condition: "No", multiplier: 1.15 },
    { sort_order: 24, condition: "No", multiplier: 1.10 },
    { sort_order: 25, condition: "No", multiplier: 1.20 },
    { sort_order: 26, condition: "No", multiplier: 1.10 },
  ];

  let multiplier = 1.0;
  for (const rm of riskMultipliers) {
    const q = bySort(rm.sort_order);
    if (!q) continue;
    if (answers[String(q.id)] !== rm.condition) continue;
    if (rm.sort_order === 26 && !hasIntegrations) continue;
    multiplier *= rm.multiplier;
  }

  const total = Math.round(subtotal * multiplier);

  // Derive overhead categories
  const workScope = (hours["Form Configuration"]        ?? 0)
                  + (hours["Workflow Configuration"]    ?? 0)
                  + (hours["Integration Configuration"] ?? 0)
                  + (hours["Financial Configuration"]   ?? 0);

  const qaAndTesting      = Math.round(workScope * 0.10);
  const uatSupport        = Math.round(workScope * 0.05);
  const programManagement = (hours["Program Management"] ?? 0) + Math.round(total * 0.10);
  const riskBuffer        = Math.max(0, total - subtotal);

  return {
    formConfiguration:        hours["Form Configuration"]        ?? 0,
    workflowConfiguration:    hours["Workflow Configuration"]    ?? 0,
    integrationConfiguration: hours["Integration Configuration"] ?? 0,
    financialConfiguration:   hours["Financial Configuration"]   ?? 0,
    userPermissions:          hours["User & Permission Setup"]   ?? 0,
    qaAndTesting,
    uatSupport,
    programManagement,
    riskBuffer,
    total,
  };
}

/** Maps EstimateBreakdown camelCase keys → proper-cased keys expected by distributeHours(). */
export function breakdownToHoursByCategory(b: EstimateBreakdown): Record<string, number> {
  return {
    "Form Configuration":        b.formConfiguration,
    "Workflow Configuration":    b.workflowConfiguration,
    "Integration Configuration": b.integrationConfiguration,
    "Financial Configuration":   b.financialConfiguration,
    "User & Permission Setup":   b.userPermissions,
    "QA & Testing":              b.qaAndTesting,
    "UAT Support":               b.uatSupport,
    "Program Management":        b.programManagement,
    "Risk Buffer":               b.riskBuffer,
  };
}
