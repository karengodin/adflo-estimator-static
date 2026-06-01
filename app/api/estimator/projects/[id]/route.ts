import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data, error } = await supabaseServer
    .from("implementation_projects")
    .select("*, implementation_phases(*), project_milestones(*), hours_summary(*)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json() as { status?: string; team_assignments?: unknown };

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined)           patch.status           = body.status;
  if (body.team_assignments !== undefined) patch.team_assignments = body.team_assignments;

  const { data, error } = await supabaseServer
    .from("implementation_projects")
    .update(patch)
    .eq("id", id)
    .select("id, status, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json(data);
}
