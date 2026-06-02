import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "./supabaseServer";

/**
 * Verifies the requesting user is an admin via Bearer token.
 * Returns the user's UUID on success, or a 401/403 NextResponse on failure.
 */
export async function requireAdmin(
  req: NextRequest
): Promise<string | NextResponse> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roleRow } = await supabaseServer
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleRow?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return user.id;
}
