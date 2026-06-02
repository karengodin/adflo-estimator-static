import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { requireAdmin } from "../../../../lib/adminAuth";

export type AuditEntry = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  metadata: Record<string, unknown>;
  source: "app" | "auth";
};

export async function GET(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const entries: AuditEntry[] = [];

  // App audit log
  const { data: appLogs } = await supabaseServer
    .from("audit_log")
    .select("id, created_at, user_id, user_email, event_type, resource_type, resource_id, resource_name, metadata")
    .order("created_at", { ascending: false })
    .limit(200);

  for (const r of appLogs ?? []) {
    entries.push({ ...(r as AuditEntry), source: "app" });
  }

  // Auth events from auth.audit_log_entries (service role only, may not be exposed)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: authLogs } = await (supabaseServer as any)
      .schema("auth")
      .from("audit_log_entries")
      .select("id, created_at, payload, ip_address")
      .order("created_at", { ascending: false })
      .limit(300);

    for (const row of authLogs ?? []) {
      const payload = (row.payload as Record<string, unknown>) ?? {};
      const action = (payload.action as string) ?? "";
      if (!["login", "logout", "token_refreshed", "user_signedup"].includes(action)) continue;
      entries.push({
        id: row.id as string,
        created_at: row.created_at as string,
        user_id: (payload.actor_id as string) ?? null,
        user_email: ((payload.traits as Record<string, unknown>)?.email as string) ?? null,
        event_type: action,
        resource_type: null,
        resource_id: null,
        resource_name: null,
        metadata: { ip: row.ip_address, actor_via_sso: payload.actor_via_sso },
        source: "auth",
      });
    }
  } catch {
    // auth schema not accessible via PostgREST — auth events will be absent
  }

  entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json(entries.slice(0, 200));
}
