import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../../lib/supabaseServer";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; milestoneId: string }> }
) {
  const { milestoneId } = await context.params;
  const body = await req.json() as {
    completed_at?: string | null;
    signed_off_by?: string | null;
    due_date?: string | null;
    notes?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.completed_at  !== undefined) patch.completed_at  = body.completed_at;
  if (body.signed_off_by !== undefined) patch.signed_off_by = body.signed_off_by;
  if (body.due_date      !== undefined) patch.due_date      = body.due_date;
  if (body.notes         !== undefined) patch.notes         = body.notes;

  const { data, error } = await supabaseServer
    .from("project_milestones")
    .update(patch)
    .eq("id", milestoneId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json(data);
}
