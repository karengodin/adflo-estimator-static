import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";

const SETTING_TO_COLUMN: Record<string, string> = {
  productHourRate:      "product_hour_rate",
  connectorHourRate:    "connector_hour_rate",
  baseHours:            "base_hours",
  bestCaseMultiplier:   "best_case_multiplier",
  worstCaseMultiplier:  "worst_case_multiplier",
};

export async function POST(req: NextRequest) {
  const { setting, value } = await req.json() as { setting: string; value: number };

  const column = SETTING_TO_COLUMN[setting];
  if (!column) {
    return NextResponse.json({ error: `Unknown setting: ${setting}` }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("logic_settings")
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq("id", "global");

  if (error) {
    console.error("[weight-suggestions/apply] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
