import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../../lib/supabaseServer";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; summaryId: string }> }
) {
  const { summaryId } = await context.params;
  const body = await req.json() as { actual_hours?: number; estimated_hours?: number; notes?: string | null };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.actual_hours    !== undefined) patch.actual_hours    = body.actual_hours;
  if (body.estimated_hours !== undefined) patch.estimated_hours = body.estimated_hours;
  if (body.notes           !== undefined) patch.notes           = body.notes;

  const { data, error } = await supabaseServer
    .from("hours_summary")
    .update(patch)
    .eq("id", summaryId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json(data);
}
