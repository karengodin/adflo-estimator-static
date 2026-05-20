import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { randomBytes } from "crypto";

// POST — create a share token for a session
// Body: { sessionId: string }
export async function POST(req: NextRequest) {
  const { sessionId } = await req.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseServer
    .from("share_tokens")
    .insert({ token, session_id: sessionId, expires_at: expiresAt });

  if (error) {
    console.error("[estimator/share] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  return NextResponse.json({ token, url: `${origin}/q/${token}` }, { status: 201 });
}

// GET ?token=xxx — validate token and return public session + questions
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const { data: tokenRow, error: tokenError } = await supabaseServer
    .from("share_tokens")
    .select("session_id, expires_at")
    .eq("token", token)
    .single();

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  const [sessionRes, questionsRes] = await Promise.all([
    supabaseServer
      .from("sessions")
      .select("id, client_name, primary_contact, answers")
      .eq("id", tokenRow.session_id)
      .single(),
    supabaseServer
      .from("questions")
      .select("id, cat, q, trigger, sort_order")
      .eq("active", true)
      .order("sort_order"),
  ]);

  if (sessionRes.error || !sessionRes.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (questionsRes.error) {
    return NextResponse.json({ error: "Failed to load questions" }, { status: 500 });
  }

  const s = sessionRes.data;
  return NextResponse.json({
    sessionId: s.id,
    companyName: s.client_name,
    answers: (s.answers as Record<string, string>) ?? {},
    questions: (questionsRes.data ?? []).map((q) => ({
      id: q.id,
      category: q.cat,
      question: q.q,
      trigger: q.trigger,
    })),
  });
}

// PATCH ?token=xxx — save answers (and optionally status) via token
// Body: { answers: Record<string, string>, status?: string }
export async function PATCH(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const { data: tokenRow, error: tokenError } = await supabaseServer
    .from("share_tokens")
    .select("session_id, expires_at")
    .eq("token", token)
    .single();

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link has expired" }, { status: 410 });
  }

  const body = await req.json() as { answers?: Record<string, string>; status?: string };
  const patch: Record<string, unknown> = {};
  if (body.answers !== undefined) patch.answers = body.answers;
  if (body.status !== undefined) patch.status = body.status;

  const { error } = await supabaseServer
    .from("sessions")
    .update(patch)
    .eq("id", tokenRow.session_id);

  if (error) {
    console.error("[estimator/share] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
