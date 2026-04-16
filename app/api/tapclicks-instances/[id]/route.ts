import { NextRequest, NextResponse } from "next/server";
import { encryptText } from "../../../../lib/crypto";
import { supabaseServer } from "../../../../lib/supabaseServer";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { error } = await supabaseServer
    .from("instances")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const body = await req.json();
    const { session_cookie } = body;

    if (!session_cookie || !session_cookie.trim()) {
      return NextResponse.json(
        { error: "session_cookie is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseServer
      .from("instances")
      .update({
        session_cookie: encryptText(session_cookie.trim()),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, name, base_url, session_cookie, cookie_expires_at, last_connected_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
