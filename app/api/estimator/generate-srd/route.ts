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

  // 4. Build prompts
  const systemPrompt = `You are a senior implementation consultant at TapClicks writing a client-facing Solutions Requirements Definition (SRD) document. You write in a professional, clear tone. You never use internal jargon. You are precise about what is and is not included in scope, and you never contradict yourself between sections.`;

  const userPrompt = `Generate a TapClicks AdFlo SRD for the following engagement. Return strict JSON only — no markdown, no backticks, no explanation.

CLIENT: ${clientName}
PRIMARY CONTACT: ${session.primary_contact || "Not provided"}
TOTAL HOURS: ${totalHours}
TIER: ${session.tier}
HOUR BREAKDOWN BY CATEGORY:
${categoryBreakdownLines}

QUESTIONS AND ANSWERS:
${qaLines}
${blockerQuestions.length > 0 ? `\nBLOCKER ITEMS:\n${blockerQuestions.map((q) => `  - ${q}`).join("\n")}` : "\nBLOCKER ITEMS: None"}
${sowQuestions.length > 0 ? `\nSOW ITEMS:\n${sowQuestions.map((q) => `  - ${q}`).join("\n")}` : "\nSOW ITEMS: None"}

RULES — follow these exactly:
1. Hours in the in_scope hours_breakdown must sum to exactly ${totalHours}. Omit any category with 0 hours.
2. out_of_scope must list only items that were explicitly answered "No" or were not triggered at all. NEVER list something as out of scope if it appears in the hours breakdown or customer objectives.
3. Cross-check: before finalizing, verify that no item appears in both in_scope and out_of_scope. If there is a conflict, keep it in scope and remove it from out_of_scope.
4. integration_strategy: if no integration questions were answered "Yes", set to null. Otherwise describe the integration approach based on the answers.
5. customer_objectives: 4–6 business-focused objectives derived from "Yes" answers. Do not list technical implementation steps — list business outcomes the client wants to achieve.
6. engagement_overview: 3–4 sentences. Reference the client name, tier, total hours, and the primary business problem being solved.
7. risks_and_flags: include blockers, complexity flags, and any questions that were unanswered. If none, return an empty array.
8. Primary contact display: if the contact is an email address only, display it as-is. Never invent a name.

Return this exact JSON shape:
{
  "engagement_overview": "string",
  "customer_objectives": ["string"],
  "system_architecture": "string",
  "in_scope": {
    "narrative": "string",
    "hours_breakdown": [{"category": "string", "hours": number, "details": "string"}],
    "total_hours": ${totalHours}
  },
  "out_of_scope": ["string"],
  "integration_strategy": "string | null",
  "risks_and_flags": ["string"]
}`;

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
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
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
    console.log("[generate-srd] out_of_scope from Claude:", JSON.stringify(srd.out_of_scope, null, 2));
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
