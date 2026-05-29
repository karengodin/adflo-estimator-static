import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../lib/supabaseServer";
import { PHASE_CONFIG, distributeHours } from "../../hours-utils";
import { calcEstimateFromAnswers, breakdownToHoursByCategory } from "../../../../../../lib/estimatorCalc";

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Resolve project → session_id
  const { data: project } = await supabaseServer
    .from("implementation_projects")
    .select("session_id")
    .eq("id", id)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Fetch everything needed in parallel
  const [sessionRes, questionsRes, phasesRes, summaryRes, logicRes] = await Promise.all([
    supabaseServer.from("sessions").select("answers").eq("id", project.session_id).single(),
    supabaseServer.from("questions").select("id, impl_category, weight, question_type, is_risk_multiplier, risk_multiplier_value, sort_order").eq("active", true),
    supabaseServer.from("implementation_phases").select("id, phase_name").eq("project_id", id),
    supabaseServer.from("hours_summary").select("id, phase_id, category").eq("project_id", id),
    supabaseServer.from("logic_settings").select("product_hour_rate, connector_hour_rate, risk_multipliers").eq("id", "global").single(),
  ]);

  const answers   = (sessionRes.data?.answers ?? {}) as Record<string, string>;
  const questions = (questionsRes.data ?? []) as Array<{
    id: number; impl_category: string | null; weight: number | null;
    question_type: string; is_risk_multiplier: boolean | null;
    risk_multiplier_value: number | null; sort_order: number;
  }>;
  const logicSettings = logicRes.data ?? {};

  console.log("[recalculate] session_id:", project.session_id);
  console.log("[recalculate] raw answers:", JSON.stringify(answers, null, 2));

  const breakdown      = calcEstimateFromAnswers(answers, questions, logicSettings);
  const hoursByCategory = breakdownToHoursByCategory(breakdown);
  const totalHours      = breakdown.total;

  console.log("[recalculate] calculated total:", totalHours, "| breakdown:", JSON.stringify({
    formConfiguration:        breakdown.formConfiguration,
    workflowConfiguration:    breakdown.workflowConfiguration,
    integrationConfiguration: breakdown.integrationConfiguration,
    financialConfiguration:   breakdown.financialConfiguration,
    userPermissions:          breakdown.userPermissions,
    riskBuffer:               breakdown.riskBuffer,
    total:                    breakdown.total,
  }));
  const distribution   = distributeHours(hoursByCategory, totalHours);

  // Build lookup maps
  const phaseIdByName: Record<string, string> = {};
  for (const p of phasesRes.data ?? []) phaseIdByName[p.phase_name] = p.id;

  // (phaseId::category) → summaryId
  const summaryIdMap: Record<string, string> = {};
  for (const s of summaryRes.data ?? []) summaryIdMap[`${s.phase_id}::${s.category}`] = s.id;

  // Upsert hours_summary rows
  const updates: PromiseLike<unknown>[] = [];
  for (const phaseCfg of PHASE_CONFIG) {
    const phaseId   = phaseIdByName[phaseCfg.name];
    if (!phaseId) continue;
    const phaseDist = distribution[phaseCfg.name];
    for (const category of phaseCfg.categories) {
      const estHours  = (phaseDist as Record<string, number>)[category] ?? 0;
      const summaryId = summaryIdMap[`${phaseId}::${category}`];
      if (summaryId) {
        updates.push(
          supabaseServer
            .from("hours_summary")
            .update({ estimated_hours: estHours, updated_at: new Date().toISOString() })
            .eq("id", summaryId)
        );
      } else {
        updates.push(
          supabaseServer
            .from("hours_summary")
            .insert({ project_id: id, phase_id: phaseId, category, estimated_hours: estHours })
        );
      }
    }
  }
  await Promise.all([
    ...updates,
    supabaseServer
      .from("sessions")
      .update({ estimated_hours: totalHours })
      .eq("id", project.session_id),
  ]);

  // Return refreshed hours_summary + the new session base hours
  const { data: refreshed } = await supabaseServer
    .from("hours_summary")
    .select("*")
    .eq("project_id", id);

  return NextResponse.json({ summary: refreshed ?? [], sessionHours: totalHours });
}
