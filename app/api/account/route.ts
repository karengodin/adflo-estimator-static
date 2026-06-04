import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabaseServer";

// Resolves the calling user from the Bearer token.
async function requireSelf(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim() ?? "";
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseServer.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return { userId: user.id };
}

export async function PATCH(req: NextRequest) {
  const result = await requireSelf(req);
  if (result instanceof NextResponse) return result;
  const { userId } = result;

  const body = await req.json() as { display_name?: string };

  if (body.display_name !== undefined) {
    const { error } = await supabaseServer
      .from("profiles")
      .update({ display_name: body.display_name })
      .eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
