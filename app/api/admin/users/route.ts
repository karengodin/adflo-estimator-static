import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { requireAdmin } from "../../../../lib/adminAuth";

export async function GET(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const { data: profiles, error } = await supabaseServer
    .from("profiles")
    .select("id, email, display_name, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: roles } = await supabaseServer
    .from("user_roles")
    .select("user_id, role");

  const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role]));

  const users = (profiles ?? []).map((p) => ({
    ...p,
    role: roleMap.get(p.id) ?? null,
  }));

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const { display_name, email, password, role } = await req.json() as {
    display_name: string;
    email: string;
    password: string;
    role: string;
  };

  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { display_name: display_name?.trim() || null, must_change_password: true },
  });

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Failed to create user" }, { status: 500 });
  }

  const newUserId = data.user.id;

  await Promise.all([
    supabaseServer.from("profiles").insert({
      id: newUserId,
      email: email.trim(),
      display_name: display_name?.trim() || null,
    }),
    role
      ? supabaseServer.from("user_roles").insert({ user_id: newUserId, role })
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true, userId: newUserId }, { status: 201 });
}
