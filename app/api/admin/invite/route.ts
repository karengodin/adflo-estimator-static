import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { requireAdmin } from "../../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const { email, role } = await req.json() as { email: string; role?: string };
  if (!email?.trim()) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer.auth.admin.inviteUserByEmail(email.trim());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Assign role immediately using the new user's ID returned by the invite call
  if (data.user?.id && role) {
    await supabaseServer
      .from("user_roles")
      .insert({ user_id: data.user.id, role })
      .select();
  }

  return NextResponse.json({ ok: true });
}
