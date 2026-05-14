import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabaseServer";

export async function GET(req: NextRequest) {
  const instanceId = req.nextUrl.searchParams.get("instanceId");
  if (!instanceId) {
    return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("extractions")
    .select("item_id, item_name, reference_table, entity_type, created_at")
    .eq("instance_id", instanceId)
    .not("item_id", "is", null)
    .order("item_name", { ascending: true });

  if (error) {
    console.error("[extractions] Query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
