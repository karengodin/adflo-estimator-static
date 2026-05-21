import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

// POST { sessionId, reason } — snapshot current estimate as a new version
export async function POST(req: NextRequest) {
  try {
    const { sessionId, reason } = await req.json() as { sessionId: string; reason?: string };
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    const [sessionRes, questionsRes] = await Promise.all([
      supabaseServer.from("sessions").select("answers, estimated_hours, tier").eq("id", sessionId).single(),
      supabaseServer.from("questions").select("id, cat, weight, question_type").eq("active", true),
    ]);

    if (!sessionRes.data) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const answers = (sessionRes.data.answers ?? {}) as Record<string, string>;
    const questions = questionsRes.data ?? [];

    const hoursByCategory: Record<string, number> = {};
    for (const q of questions) {
      if (q.question_type === "yesno" && answers[String(q.id)] === "Yes") {
        const cat = (q.cat as string) ?? "Other";
        hoursByCategory[cat] = (hoursByCategory[cat] ?? 0) + (q.weight ?? 0);
      }
    }

    // Next version number
    const { count } = await supabaseServer
      .from("estimate_versions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    const versionNumber = (count ?? 0) + 1;

    // Mark all previous versions as not current
    await supabaseServer
      .from("estimate_versions")
      .update({ is_current: false })
      .eq("session_id", sessionId);

    const { data: version, error } = await supabaseServer
      .from("estimate_versions")
      .insert({
        session_id:        sessionId,
        version_number:    versionNumber,
        total_hours:       sessionRes.data.estimated_hours,
        tier:              sessionRes.data.tier,
        hours_by_category: hoursByCategory,
        reason_for_change: reason ?? null,
        is_current:        true,
      })
      .select()
      .single();

    if (error || !version) {
      return NextResponse.json({ error: error?.message ?? "Failed to create version" }, { status: 500 });
    }

    return NextResponse.json(version, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET ?sessionId=xxx — all versions in order
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("estimate_versions")
    .select()
    .eq("session_id", sessionId)
    .order("version_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
