import { NextRequest, NextResponse } from "next/server";
import { encryptText } from "../../../lib/crypto";
import { supabaseServer } from "../../../lib/supabaseServer";

export async function GET() {
  const { data, error } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, session_cookie, cookie_expires_at, last_connected_at")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, base_url, session_cookie } = body;

    if (!name || !name.trim() || !base_url || !base_url.trim()) {
      return NextResponse.json(
        { error: "Missing required fields: name, base_url" },
        { status: 400 }
      );
    }

    const encrypted_cookie =
      session_cookie && session_cookie.trim()
        ? encryptText(session_cookie.trim())
        : null;

    const { data, error } = await supabaseServer
      .from("instances")
      .insert({
        name: name.trim(),
        base_url: base_url.trim(),
        session_cookie: encrypted_cookie,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select("id, name, base_url, session_cookie, cookie_expires_at, last_connected_at, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
