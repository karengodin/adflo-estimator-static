import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("extractions")
    .select("id, created_at, entity_type, instance_id, data")
    .eq("id", id)
    .is("item_id", null)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  const items = Array.isArray(data.data)
    ? (data.data as { id: string; name: string; raw: unknown }[])
    : [];

  return NextResponse.json({
    id:           data.id,
    created_at:   data.created_at,
    entity_type:  data.entity_type,
    instance_id:  data.instance_id,
    record_count: items.length,
    items,
  });
}
