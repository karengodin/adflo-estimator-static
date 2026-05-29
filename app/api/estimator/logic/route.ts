import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

type DbTier = { name: string; min_hours: number; timeline: string };
type UiTier = { name: string; minHours: number; timeline: string };

function tiersToUi(tiers: DbTier[]): UiTier[] {
  return (tiers ?? []).map((t) => ({ name: t.name, minHours: t.min_hours, timeline: t.timeline }));
}

function tiersToDb(tiers: UiTier[]): DbTier[] {
  return (tiers ?? []).map((t) => ({ name: t.name, min_hours: t.minHours, timeline: t.timeline }));
}

// GET — return logic settings mapped to UI shape
export async function GET() {
  const { data, error } = await supabaseServer
    .from("logic_settings")
    .select("base_hours, best_case_multiplier, worst_case_multiplier, tiers, product_hour_rate, connector_hour_rate, risk_multipliers")
    .eq("id", "global")
    .single();

  if (error || !data) {
    console.error("[estimator/logic] GET error:", error?.message);
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 500 });
  }

  const d = data as Record<string, unknown>;
  return NextResponse.json({
    baseHours:            data.base_hours,
    bestCaseMultiplier:   data.best_case_multiplier,
    worstCaseMultiplier:  data.worst_case_multiplier,
    tiers:                tiersToUi(data.tiers as DbTier[]),
    productHourRate:      d.product_hour_rate as number ?? 4,
    connectorHourRate:    d.connector_hour_rate as number ?? 12,
    riskMultipliers:      (
      (d.risk_multipliers as Array<{ sort_order?: number; question_id?: number; condition: string; multiplier: number }> | null)
        ?.map((rm) => ({ sort_order: rm.sort_order ?? rm.question_id ?? 0, condition: rm.condition, multiplier: rm.multiplier }))
    ) ?? [
      { sort_order: 23, condition: "No", multiplier: 1.15 },
      { sort_order: 24, condition: "No", multiplier: 1.10 },
      { sort_order: 25, condition: "No", multiplier: 1.20 },
      { sort_order: 26, condition: "No", multiplier: 1.10 },
    ],
  });
}

// PATCH — update logic settings
export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    baseHours: number;
    bestCaseMultiplier: number;
    worstCaseMultiplier: number;
    tiers: UiTier[];
    productHourRate?: number;
    connectorHourRate?: number;
    riskMultipliers?: Array<{ sort_order: number; condition: string; multiplier: number }>;
  };

  const patch: Record<string, unknown> = {
    base_hours:              body.baseHours,
    best_case_multiplier:    body.bestCaseMultiplier,
    worst_case_multiplier:   body.worstCaseMultiplier,
    tiers:                   tiersToDb(body.tiers),
    updated_at:              new Date().toISOString(),
  };
  if (body.productHourRate   !== undefined) patch.product_hour_rate   = body.productHourRate;
  if (body.connectorHourRate !== undefined) patch.connector_hour_rate = body.connectorHourRate;
  if (body.riskMultipliers   !== undefined) patch.risk_multipliers    = body.riskMultipliers;

  const { error } = await supabaseServer
    .from("logic_settings")
    .update(patch)
    .eq("id", "global");

  if (error) {
    console.error("[estimator/logic] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
