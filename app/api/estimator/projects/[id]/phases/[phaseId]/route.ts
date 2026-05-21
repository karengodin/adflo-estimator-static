import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../../lib/supabaseServer";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; phaseId: string }> }
) {
  const { phaseId } = await context.params;
  const body = await req.json() as {
    status?: string;
    planned_start?: string | null;
    actual_start?: string | null;
    planned_end?: string | null;
    actual_end?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.status        !== undefined) patch.status        = body.status;
  if (body.planned_start !== undefined) patch.planned_start = body.planned_start;
  if (body.actual_start  !== undefined) patch.actual_start  = body.actual_start;
  if (body.planned_end   !== undefined) patch.planned_end   = body.planned_end;
  if (body.actual_end    !== undefined) patch.actual_end    = body.actual_end;

  const { data, error } = await supabaseServer
    .from("implementation_phases")
    .update(patch)
    .eq("id", phaseId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json(data);
}
