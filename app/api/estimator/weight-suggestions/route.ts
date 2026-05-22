import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

export async function GET() {
  // Fetch completed phases
  const { data: phases } = await supabaseServer
    .from("implementation_phases")
    .select("id, project_id")
    .eq("status", "complete")
    .not("actual_end", "is", null);

  const phaseIds = (phases ?? []).map((p: { id: string; project_id: string }) => p.id);

  if (phaseIds.length === 0) {
    return NextResponse.json({ suggestions: [], insufficientData: true, projectCount: 0 });
  }

  // Fetch hours for those phases
  const { data: hours } = await supabaseServer
    .from("hours_summary")
    .select("category, estimated_hours, actual_hours, phase_id")
    .in("phase_id", phaseIds);

  // Build phase_id → project_id map, then aggregate by category
  const phaseProjectMap: Record<string, string> = Object.fromEntries(
    (phases ?? []).map((p: { id: string; project_id: string }) => [p.id, p.project_id])
  );

  type Agg = { projects: Set<string>; estimated: number; actual: number };
  const aggMap: Record<string, Agg> = {};

  for (const h of (hours ?? []) as { category: string; estimated_hours: number; actual_hours: number; phase_id: string }[]) {
    const projectId = phaseProjectMap[h.phase_id];
    if (!projectId) continue;
    if (!aggMap[h.category]) aggMap[h.category] = { projects: new Set(), estimated: 0, actual: 0 };
    aggMap[h.category].projects.add(projectId);
    aggMap[h.category].estimated += h.estimated_hours ?? 0;
    aggMap[h.category].actual   += h.actual_hours   ?? 0;
  }

  const maxProjectCount = Math.max(0, ...Object.values(aggMap).map((a) => a.projects.size));
  const qualifying = Object.entries(aggMap)
    .filter(([, agg]) => agg.projects.size >= 3)
    .map(([category, agg]) => ({
      category,
      project_count:     agg.projects.size,
      total_estimated:   agg.estimated,
      total_actual:      agg.actual,
      avg_variance_pct:  agg.estimated > 0
        ? Math.round(((agg.actual - agg.estimated) / agg.estimated) * 100)
        : 0,
    }))
    .sort((a, b) => Math.abs(b.avg_variance_pct) - Math.abs(a.avg_variance_pct));

  if (qualifying.length === 0) {
    return NextResponse.json({ suggestions: [], insufficientData: true, projectCount: maxProjectCount });
  }

  // Fetch current logic settings
  const { data: ls } = await supabaseServer
    .from("logic_settings")
    .select("product_hour_rate, connector_hour_rate, base_hours, best_case_multiplier, worst_case_multiplier")
    .eq("id", "global")
    .single();

  const currentSettings = {
    productHourRate:      (ls as Record<string, number> | null)?.product_hour_rate      ?? 4,
    connectorHourRate:    (ls as Record<string, number> | null)?.connector_hour_rate    ?? 12,
    baseHours:            (ls as Record<string, number> | null)?.base_hours             ?? 0,
    bestCaseMultiplier:   (ls as Record<string, number> | null)?.best_case_multiplier   ?? 0.8,
    worstCaseMultiplier:  (ls as Record<string, number> | null)?.worst_case_multiplier  ?? 1.3,
  };

  const userMessage = JSON.stringify({ variance_data: qualifying, current_settings: currentSettings });

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: "You are an implementation estimation advisor. Given variance data from completed project phases and current logic settings, suggest specific adjustments to improve estimate accuracy. Be conservative — only suggest changes where the pattern is consistent and meaningful. Return a JSON array only, no markdown.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const anthropicData = await anthropicRes.json() as { content?: { text: string }[]; error?: { message?: string } };

  if (!anthropicData.content?.length) {
    const errMsg = anthropicData.error?.message ?? "Unexpected Anthropic response";
    console.error("[weight-suggestions] Anthropic error:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  let raw = anthropicData.content[0].text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();

  let suggestions: unknown[];
  try {
    const parsed = JSON.parse(raw);
    suggestions = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error("[weight-suggestions] JSON parse failed:", raw.slice(0, 300));
    return NextResponse.json({ error: "Failed to parse suggestions from Claude" }, { status: 502 });
  }

  return NextResponse.json({ suggestions, insufficientData: false });
}
