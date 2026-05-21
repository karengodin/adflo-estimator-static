import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { PHASE_CONFIG, distributeHours } from "./hours-utils";
import { calcEstimateFromAnswers, breakdownToHoursByCategory } from "../../../../lib/estimatorCalc";

const DEFAULT_MILESTONES = [
  { name: "SRD Signed",                   phase: "discovery" },
  { name: "Pilot Sign-off",               phase: "pilot" },
  { name: "UAT Sign-off (Checkpoint 2)",  phase: "uat" },
  { name: "Production Go-Live Confirmed", phase: "golive" },
];

// ─── POST — create project ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json() as { sessionId: string };
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    // Guard duplicates
    const { data: existing } = await supabaseServer
      .from("implementation_projects")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (existing) return NextResponse.json({ error: "Project already exists" }, { status: 409 });

    // Fetch session + questions + logic settings
    const [sessionRes, questionsRes, logicRes] = await Promise.all([
      supabaseServer.from("sessions").select("answers, tier").eq("id", sessionId).single(),
      supabaseServer.from("questions").select("id, impl_category, weight, question_type, is_risk_multiplier, risk_multiplier_value, sort_order").eq("active", true),
      supabaseServer.from("logic_settings").select("product_hour_rate, connector_hour_rate").eq("id", "global").single(),
    ]);

    const sessionData   = sessionRes.data;
    const answers       = (sessionData?.answers ?? {}) as Record<string, string>;
    const questions     = (questionsRes.data ?? []) as Array<{
      id: number; impl_category: string | null; weight: number | null;
      question_type: string; is_risk_multiplier: boolean | null;
      risk_multiplier_value: number | null; sort_order: number;
    }>;
    const logicSettings = logicRes.data ?? {};

    // Compute per-category and total hours using shared server-side calc
    const breakdown       = calcEstimateFromAnswers(answers, questions, logicSettings);
    const hoursByCategory = breakdownToHoursByCategory(breakdown);
    const totalHours      = breakdown.total;

    // Compute phase→category estimated hours
    const distribution = distributeHours(hoursByCategory, totalHours);

    // Create project
    const { data: project, error: projErr } = await supabaseServer
      .from("implementation_projects")
      .insert({ session_id: sessionId })
      .select("id")
      .single();
    if (projErr || !project) {
      return NextResponse.json({ error: projErr?.message ?? "Failed to create project" }, { status: 500 });
    }

    // Create phases
    const { data: phases, error: phaseErr } = await supabaseServer
      .from("implementation_phases")
      .insert(PHASE_CONFIG.map((p) => ({ project_id: project.id, phase_name: p.name, phase_order: p.order })))
      .select("id, phase_name");
    if (phaseErr || !phases) {
      return NextResponse.json({ error: phaseErr?.message ?? "Failed to create phases" }, { status: 500 });
    }

    // Create default milestones
    await supabaseServer.from("project_milestones").insert(
      DEFAULT_MILESTONES.map((m) => ({ ...m, project_id: project.id }))
    );

    // Create hours_summary rows: fixed categories per phase with distributed estimates
    const summaryInserts: Array<{ project_id: string; phase_id: string; category: string; estimated_hours: number }> = [];
    for (const phase of phases) {
      const phaseCfg  = PHASE_CONFIG.find((p) => p.name === phase.phase_name);
      const phaseDist = distribution[phase.phase_name as keyof typeof distribution] ?? {};
      if (!phaseCfg) continue;
      for (const category of phaseCfg.categories) {
        summaryInserts.push({
          project_id:      project.id,
          phase_id:        phase.id,
          category,
          estimated_hours: phaseDist[category as keyof typeof phaseDist] ?? 0,
        });
      }
    }
    if (summaryInserts.length > 0) {
      await supabaseServer.from("hours_summary").insert(summaryInserts);
    }

    // Return full project
    const { data: full } = await supabaseServer
      .from("implementation_projects")
      .select("*, implementation_phases(*), project_milestones(*), hours_summary(*)")
      .eq("id", project.id)
      .single();

    return NextResponse.json(full, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    console.error("[projects] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── GET ?sessionId=xxx ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("implementation_projects")
    .select("*, implementation_phases(*), project_milestones(*), hours_summary(*)")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? null);
}
