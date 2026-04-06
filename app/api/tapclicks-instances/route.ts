import { NextRequest, NextResponse } from "next/server";
import { encryptText } from "../../../lib/crypto";
import { supabaseServer } from "../../../lib/supabaseServer";

export async function GET() {
  const { data, error } = await supabaseServer
    .from("tapclicks_instances")
    .select(
      "id, instance_key, label, base_url, login_email, is_active, encrypted_cookie, last_login_at, last_login_status, last_error, created_at, updated_at"
    )
    .order("label", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      instance_key,
      label,
      base_url,
      login_email,
      password,
      session_cookie,
      is_active = true,
    } = body;

    if (!instance_key || !label || !base_url || !login_email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { data: existing } = await supabaseServer
      .from("tapclicks_instances")
      .select("encrypted_password, encrypted_cookie")
      .eq("instance_key", instance_key)
      .maybeSingle();

    const encrypted_password =
      password && password.trim()
        ? encryptText(password.trim())
        : existing?.encrypted_password || "";

    const encrypted_cookie =
      session_cookie && session_cookie.trim()
        ? encryptText(session_cookie.trim())
        : existing?.encrypted_cookie || null;

    const { data, error } = await supabaseServer
      .from("tapclicks_instances")
      .upsert(
        {
          instance_key,
          label,
          base_url,
          login_email,
          encrypted_password,
          encrypted_cookie,
          is_active,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instance_key" }
      )
      .select(
        "id, instance_key, label, base_url, login_email, is_active, encrypted_cookie, last_login_at, last_login_status, last_error, created_at, updated_at"
      )
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