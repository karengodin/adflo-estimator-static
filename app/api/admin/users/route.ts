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
  try {
    const check = await requireAdmin(req);
    if (check instanceof NextResponse) return check;

    const { display_name, email, role, password } = await req.json() as {
      display_name: string;
      email: string;
      role: string;
      password: string;
    };

    if (!email?.trim()) return NextResponse.json({ error: "email required" }, { status: 400 });
    if (!password?.trim()) return NextResponse.json({ error: "password required" }, { status: 400 });

    console.log(`[admin/users POST] Starting user creation for ${email}`);

    const createResult = await supabaseServer.auth.admin.createUser({
      email: email.trim(),
      password: password.trim(),
      email_confirm: true,
      user_metadata: { display_name: display_name?.trim() || null, must_change_password: true },
    });
    console.log("[admin/users POST] createUser result:", {
      userId: createResult.data?.user?.id ?? null,
      error: createResult.error ? { message: createResult.error.message, status: createResult.error.status, code: (createResult.error as { code?: string }).code } : null,
    });

    if (createResult.error || !createResult.data.user) {
      return NextResponse.json({ error: createResult.error?.message ?? "Failed to create user" }, { status: 500 });
    }

    const newUserId = createResult.data.user.id;

    const profileResult = await supabaseServer.from("profiles").insert({
      id: newUserId,
      email: email.trim(),
      display_name: display_name?.trim() || null,
    });
    console.log("[admin/users POST] profiles insert result:", {
      status: profileResult.status,
      error: profileResult.error ? { message: profileResult.error.message, code: profileResult.error.code } : null,
    });

    if (role) {
      const roleResult = await supabaseServer.from("user_roles").insert({ user_id: newUserId, role });
      console.log("[admin/users POST] user_roles insert result:", {
        status: roleResult.status,
        error: roleResult.error ? { message: roleResult.error.message, code: roleResult.error.code } : null,
      });
    }

    return NextResponse.json({ ok: true, userId: newUserId }, { status: 201 });
  } catch (err: unknown) {
    const e = err as Error;
    console.error("[admin/users POST] Unexpected error:", { message: e?.message, code: (e as { code?: string })?.code, stack: e?.stack });
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
