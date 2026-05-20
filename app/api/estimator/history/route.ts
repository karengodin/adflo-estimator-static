import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

// GET — list all history entries, newest first
export async function GET() {
  const { data, error } = await supabaseServer
    .from("history")
    .select("id, client_name, rep_name, date_completed, estimated_hours, actual_hours, tier, timeline, created_at")
    .order("date_completed", { ascending: false });

  if (error) {
    console.error("[estimator/history] GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
