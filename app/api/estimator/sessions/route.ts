import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

// DB columns: id, client_name, primary_contact, rep_name, created_at, updated_at,
//             status, answers, activated_levers, estimated_hours, tier, notes, share_token
//
// UI Session shape (page.tsx): id, company_name, primary_contact, answers,
//   activated_levers, estimated_hours, tier, timeline, status, submitted_at, updated_at, notes
//
// Mappings:
//   DB client_name  → UI company_name
//   DB created_at   → UI submitted_at   (also returned as created_at for convenience)
//   timeline        — not stored in DB; always returned as null (compute from tier+logic if needed)

type DbSession = {
  id: string;
  client_name: string;
  slug: string;
  session_number: number;
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
    slug:             row.slug,
    session_number:   row.session_number,
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

const SESSION_SELECT = "id, slug, session_number, client_name, primary_contact, created_at, updated_at, status, answers, activated_levers, estimated_hours, tier, notes, intake_notes, transcript";

// GET — list all sessions (newest first) or single session by ?slug=&session_number=
export async function GET(req: NextRequest) {
  const slug          = req.nextUrl.searchParams.get("slug");
  const sessionNumber = req.nextUrl.searchParams.get("session_number");

  if (slug && sessionNumber) {
    const { data, error } = await supabaseServer
      .from("sessions")
      .select(SESSION_SELECT)
      .eq("slug", slug)
      .eq("session_number", parseInt(sessionNumber, 10))
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
    return NextResponse.json(toUi(data as DbSession));
  }

  const { data, error } = await supabaseServer
    .from("sessions")
    .select(SESSION_SELECT)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[estimator/sessions] GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(r => toUi(r as DbSession)));
}

// POST — create new session
// Body: { company_name, primary_contact?, answers, activated_levers, estimated_hours, tier, status }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    company_name: string;
    primary_contact?: string | null;
    answers: Record<string, string>;
    activated_levers: number[];
    estimated_hours: number;
    tier: string;
    status: string;
  };

  const clientName = body.company_name || "Untitled";

  const { data, error } = await supabaseServer
    .from("sessions")
    .insert({
      client_name:      clientName,
      slug:             toSlug(clientName),
      primary_contact:  body.primary_contact ?? null,
      answers:          body.answers ?? {},
      activated_levers: body.activated_levers ?? [],
      estimated_hours:  body.estimated_hours ?? 0,
      tier:             body.tier ?? "Bronze",
      status:           body.status ?? "draft",
    })
    .select(SESSION_SELECT)
    .single();

  if (error || !data) {
    console.error("[estimator/sessions] POST error:", error?.message);
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json(toUi(data as DbSession), { status: 201 });
}
