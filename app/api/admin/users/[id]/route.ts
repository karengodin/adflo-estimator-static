import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";
import { requireAdmin } from "../../../../../lib/adminAuth";
import { logEvent } from "../../../../../lib/audit";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;
  const adminUserId = check as string;

  const { id } = await context.params;
  const body = await req.json() as {
    role?: string;
    display_name?: string;
    email?: string;
    password?: string;
  };

  if (body.role !== undefined) {
    await supabaseServer.from("user_roles").delete().eq("user_id", id);
    const { error } = await supabaseServer.from("user_roles").insert({ user_id: id, role: body.role });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: profile } = await supabaseServer.from("profiles").select("email").eq("id", id).single();
    logEvent({
      userId: adminUserId,
      eventType: "role_changed",
      resourceType: "user",
      resourceId: id,
      resourceName: (profile?.email as string | null) ?? id,
      metadata: { new_role: body.role },
    }).catch(() => {});
  }

  if (body.display_name !== undefined) {
    const { error } = await supabaseServer
      .from("profiles")
      .update({ display_name: body.display_name })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.email !== undefined) {
    const { error } = await supabaseServer.auth.admin.updateUserById(id, { email: body.email });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Keep profile email in sync
    await supabaseServer.from("profiles").update({ email: body.email }).eq("id", id);
  }

  if (body.password !== undefined) {
    console.log("[admin/users PATCH] setting password for id:", id);
    const { data: pwData, error: pwError } = await supabaseServer.auth.admin.updateUserById(id, {
      password: body.password,
      user_metadata: { must_change_password: true },
    });
    console.log("[admin/users PATCH] updateUserById result:", { userId: pwData?.user?.id ?? null, error: pwError });
    if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const { id } = await context.params;

  const { error } = await supabaseServer.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
