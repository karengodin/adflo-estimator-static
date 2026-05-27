import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";

type DbSession = {
  id: string;
  client_name: string;
  primary_contact: string | null;
  created_at: string;
  updated_at: string | null;
  status: string;
  answers: Record<string, string>;
  activated_levers: number[];
  estimated_hours: number;
  tier: string;
  notes: string | null;
  intake_notes: Record<string, string> | null;
  transcript?: unknown;
};

function toUi(row: DbSession) {
  return {
    id:               row.id,
    company_name:     row.client_name,
    primary_contact:  row.primary_contact ?? null,
    answers:          row.answers ?? {},
    activated_levers: row.activated_levers ?? [],
    estimated_hours:  row.estimated_hours,
    tier:             row.tier,
    timeline:         null as string | null,
    status:           row.status,
    submitted_at:     row.created_at,
    updated_at:       row.updated_at ?? null,
    notes:            row.notes ?? null,
    intake_notes:     row.intake_notes ?? null,
    transcript:       (row.transcript as Array<{ role: string; content: string }> | null) ?? null,
  };
}

const SELECT = "id, client_name, primary_contact, created_at, updated_at, status, answers, activated_levers, estimated_hours, tier, notes, intake_notes, transcript";

// GET — fetch a single session by id
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data, error } = await supabaseServer
    .from("sessions")
    .select(SELECT)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json(toUi(data as DbSession));
}

// PATCH — update a session
// Accepts any subset of: company_name, primary_contact, notes, answers,
//   activated_levers, estimated_hours, tier, status
// Ignores: timeline, updated_at (DB trigger handles updated_at)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json() as {
    company_name?: string;
    primary_contact?: string | null;
    notes?: string | null;
    answers?: Record<string, string>;
    activated_levers?: number[];
    estimated_hours?: number;
    tier?: string;
    status?: string;
  };

  const patch: Record<string, unknown> = {};
  if (body.company_name   !== undefined) patch.client_name      = body.company_name || "Untitled";
  if (body.primary_contact !== undefined) patch.primary_contact = body.primary_contact ?? null;
  if (body.notes           !== undefined) patch.notes           = body.notes ?? null;
  if (body.answers         !== undefined) patch.answers         = body.answers;
  if (body.activated_levers !== undefined) patch.activated_levers = body.activated_levers;
  if (body.estimated_hours !== undefined) patch.estimated_hours = body.estimated_hours;
  if (body.tier            !== undefined) patch.tier            = body.tier;
  if (body.status          !== undefined) patch.status          = body.status;

  const { data, error } = await supabaseServer
    .from("sessions")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error || !data) {
    console.error("[estimator/sessions/id] PATCH error:", error?.message);
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json(toUi(data as DbSession));
}

// DELETE — remove a session
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { error } = await supabaseServer
    .from("sessions")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[estimator/sessions/id] DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
