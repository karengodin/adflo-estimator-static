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
    .select("base_hours, best_case_multiplier, worst_case_multiplier, tiers, product_hour_rate, connector_hour_rate")
    .eq("id", "global")
    .single();

  if (error || !data) {
    console.error("[estimator/logic] GET error:", error?.message);
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 500 });
  }

  return NextResponse.json({
    baseHours:            data.base_hours,
    bestCaseMultiplier:   data.best_case_multiplier,
    worstCaseMultiplier:  data.worst_case_multiplier,
    tiers:                tiersToUi(data.tiers as DbTier[]),
    productHourRate:      (data as Record<string, unknown>).product_hour_rate as number ?? 4,
    connectorHourRate:    (data as Record<string, unknown>).connector_hour_rate as number ?? 12,
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
