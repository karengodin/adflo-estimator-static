import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabaseServer";

export async function GET(req: NextRequest) {
  const instanceId = req.nextUrl.searchParams.get("instanceId");
  if (!instanceId) {
    return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("migration_runs")
    .select("entity_type, item_id, item_name, status, http_code, snippet, run_at, is_retry")
    .eq("instance_id", instanceId)
    .order("run_at", { ascending: false });

  if (error) {
    console.error("[migration-runs] Query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
