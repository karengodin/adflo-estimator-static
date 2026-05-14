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
    const { name, base_url: rawUrl, login_email, instance_key, session_cookie } = body;

    // At least one field must be provided
    if (!name && !rawUrl && !login_email && !instance_key && !session_cookie) {
      return NextResponse.json(
        { error: "No fields provided to update" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name?.trim())        updates.name         = name.trim();
    if (rawUrl?.trim()) {
      updates.base_url = rawUrl.trim().startsWith("http")
        ? rawUrl.trim()
        : "https://" + rawUrl.trim();
    }
    if (login_email !== undefined) updates.login_email  = login_email?.trim() || null;
    if (instance_key !== undefined) updates.instance_key = instance_key?.trim() || null;
    if (session_cookie?.trim())     updates.session_cookie = encryptText(session_cookie.trim());

    const { data, error } = await supabaseServer
      .from("instances")
      .update(updates)
      .eq("id", id)
      .select("id, name, base_url, login_email, instance_key, session_cookie, cookie_expires_at, last_connected_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
