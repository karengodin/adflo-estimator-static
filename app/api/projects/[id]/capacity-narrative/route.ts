import { NextRequest, NextResponse } from "next/server";

type AssignedIM = {
  name: string;
  role: string;
  hoursPerWeek: number;
  experienceMultiplier: number;
};

type RequestBody = {
  totalHours: number;
  weeklyCapacity: number;
  adjustedWeeks: number;
  assignedIMs: AssignedIM[];
  projectTier: string;
  topCategories: { category: string; estimatedHours: number }[];
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Project ID required" }, { status: 400 });

  const body = await req.json() as RequestBody;
  const { totalHours, weeklyCapacity, adjustedWeeks, assignedIMs, projectTier, topCategories } = body;

  const imSummary = assignedIMs.length > 0
    ? assignedIMs.map((im) =>
        `${im.name || "IM"} (${im.role || "Implementer"}, ${im.hoursPerWeek} hrs/wk, ${im.experienceMultiplier}x experience)`
      ).join("; ")
    : "No IMs assigned";

  const catSummary = topCategories.length > 0
    ? topCategories.map((c) => `${c.category}: ${c.estimatedHours} hrs`).join(", ")
    : "No category data";

  const userMessage = `Project tier: ${projectTier}. Total estimated hours: ${totalHours}. Weekly team capacity: ${weeklyCapacity} hrs/wk. Adjusted timeline: ${adjustedWeeks} weeks. Team: ${imSummary}. Top work categories: ${catSummary}.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: "You are an implementation capacity advisor for a SaaS onboarding team. Given project scope and team assignment data, write a 2–3 sentence plain-English risk assessment. Be specific and direct. Flag genuine risks only — don't pad with obvious statements. Never use bullet points.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const data = await res.json() as { content?: { text: string }[]; error?: { message?: string } };
  if (!data.content?.length) {
    const errMsg = data.error?.message ?? "Unexpected response from Anthropic API";
    console.log("[capacity-narrative] unexpected response:", JSON.stringify(data));
    return NextResponse.json({ narrative: null, error: errMsg }, { status: 200 });
  }
  const text = data.content[0].text.trim();
  return NextResponse.json({ narrative: text });
}
