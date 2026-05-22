import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  // 1. Fetch session
  const { data: session, error: sessionError } = await supabaseServer
    .from("sessions")
    .select("id, client_name, primary_contact, answers, estimated_hours, tier, notes")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 2. Fetch questions
  const { data: questions, error: questionsError } = await supabaseServer
    .from("questions")
    .select("id, cat, q, trigger, weight, blocker, sow")
    .eq("active", true)
    .order("sort_order");

  if (questionsError) {
    return NextResponse.json({ error: "Failed to load questions" }, { status: 500 });
  }

  // 3. Build context
  const answers = (session.answers as Record<string, string>) ?? {};
  const qs = questions ?? [];

  // Per-category weight totals (for hours allocation guidance)
  const categoryWeights: Record<string, number> = {};
  let triggeredWeight = 0;
  const blockerQuestions: string[] = [];
  const sowQuestions: string[] = [];

  for (const q of qs) {
    if (answers[String(q.id)] === q.trigger) {
      categoryWeights[q.cat] = (categoryWeights[q.cat] ?? 0) + q.weight;
      triggeredWeight += q.weight;
      if (q.blocker) blockerQuestions.push(q.q);
      if (q.sow) sowQuestions.push(q.q);
    }
  }

  const baseHours = session.estimated_hours - triggeredWeight;
  const categoryBreakdownLines = Object.entries(categoryWeights)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, hrs]) => `  ${cat}: ${hrs} hrs`)
    .join("\n") || "  (No questions triggered additional hours)";

  // Build Q&A lines grouped by category
  const qaLines = qs
    .map((q) => {
      const ans = answers[String(q.id)] ?? "Not answered";
      const triggered = ans === q.trigger;
      const flags = [
        triggered ? "ADDS HOURS" : "",
        q.blocker && triggered ? "BLOCKER" : "",
        q.sow && triggered ? "SOW ITEM" : "",
      ].filter(Boolean).join(", ");
      return `[${q.cat}] ${q.q}: ${ans}${flags ? ` (${flags})` : ""}`;
    })
    .join("\n");

  const totalHours: number = session.estimated_hours;
  const clientName: string = session.client_name || "Client";

  // 4. Build prompt
  const prompt = `You are generating a Solutions Requirements Definition (SRD) document for a TapClicks AdFlo Order Management & Workflow implementation project.

CLIENT: ${clientName}
REP / PRIMARY CONTACT: ${session.primary_contact || "TapClicks Team"}
ESTIMATED TOTAL HOURS: ${totalHours}
TIER: ${session.tier}
BASE HOURS (always included): ${baseHours}
HOURS BY QUESTIONNAIRE CATEGORY (triggered questions only):
${categoryBreakdownLines}
${blockerQuestions.length > 0 ? `\nBLOCKER QUESTIONS TRIGGERED:\n${blockerQuestions.map((q) => `  - ${q}`).join("\n")}` : ""}
${sowQuestions.length > 0 ? `\nSOW-WORTHY ITEMS TRIGGERED:\n${sowQuestions.map((q) => `  - ${q}`).join("\n")}` : ""}

QUESTIONNAIRE (all ${qs.length} questions with answers):
${qaLines}

Return ONLY a valid JSON object — no markdown, no backticks, no explanation before or after. The JSON must have exactly these keys:

{
  "engagement_overview": "2-3 sentences. ${clientName} is implementing TapClicks AdFlo Order Management & Workflow. Mention that discovery was completed and this engagement covers initial configuration, UAT support, and go-live preparation. Reference the tier (${session.tier}) and ${totalHours}-hour scope.",
  "customer_objectives": ["objective 1", "objective 2", "..."],
  "system_architecture": "1-2 paragraphs describing the order model, product/line-item structure, and workflow approach — inferred from the questionnaire answers. Be specific about what was answered Yes.",
  "in_scope": {
    "narrative": "2-3 sentences summarising what TapClicks will deliver in this engagement.",
    "hours_breakdown": {
      "rows": [
        { "label": "Form Configuration", "hours": <integer>, "detail": ["Product forms - X hrs", "Order forms - X hrs"] },
        { "label": "Workflow Configuration", "hours": <integer>, "detail": ["<specific workflow items based on answers>"] },
        { "label": "Integration Configuration", "hours": <integer>, "detail": ["<only include if integrations answered Yes>"] },
        { "label": "Financial Configuration", "hours": <integer>, "detail": ["<only include if financial questions answered Yes>"] },
        { "label": "QA & Testing", "hours": <integer>, "detail": ["TapClicks internal QA of configured forms and workflows"] },
        { "label": "UAT Support", "hours": <integer>, "detail": ["UAT preparation, scripts, and support"] },
        { "label": "Program Management", "hours": <integer>, "detail": ["Project management, communication, and coordination"] }
      ],
      "total": ${totalHours}
    }
  },
  "out_of_scope": ["Active campaign migration", "Historical data migration", "Custom margin configuration", "Rate card configuration", "Orders reporting configuration"],
  "integration_strategy": null,
  "risks_and_flags": []
}

Rules:
- hours_breakdown rows must sum exactly to ${totalHours}. Omit Integration Configuration or Financial Configuration rows if no questions in those categories were answered Yes. Include rows proportional to triggered weights: forms ~40-50%, workflow ~15-25%, integrations if applicable, QA ~10%, UAT ~10%, Program Management ~10%.
- out_of_scope: always include the 5 standard items shown. Add additional items for any integrations or features that were answered "No" or "Not answered".
- integration_strategy: set to null if no integration questions were answered "Yes". Otherwise describe the integration approach.
- risks_and_flags: include any blockers, complexity items, or "Not answered" questions that could affect timeline. Empty array if none.
- customer_objectives: infer 4-6 business objectives from what the client said Yes to. Be business-focused, not technical.
- Write in a professional, client-facing tone. No jargon. No internal implementation details.`;

  // 5. Call Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  let rawContent: string;
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });
    rawContent = (message.content[0] as { text: string }).text.trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Claude API error";
    console.error("[generate-srd] Claude error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // 6. Parse JSON — strip code fences if Claude added them
  let srd: Record<string, unknown>;
  try {
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    srd = JSON.parse(cleaned);
  } catch {
    console.error("[generate-srd] JSON parse failed. Raw:", rawContent.slice(0, 300));
    return NextResponse.json(
      { error: "Failed to parse SRD from Claude. The model returned non-JSON output." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ...srd,
    meta: {
      clientName: session.client_name,
      repName: session.primary_contact,
      estimatedHours: session.estimated_hours,
      tier: session.tier,
      generatedAt: new Date().toISOString(),
      generated_by: "ai",
    },
  });
}
