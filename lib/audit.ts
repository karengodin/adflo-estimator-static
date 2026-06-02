import { supabaseServer } from "./supabaseServer";
import type { NextRequest } from "next/server";

export interface AuditEvent {
  userId?: string | null;
  userEmail?: string | null;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logEvent(event: AuditEvent): Promise<void> {
  try {
    const payload = {
      user_id: event.userId ?? null,
      user_email: event.userEmail ?? null,
      event_type: event.eventType,
      resource_type: event.resourceType ?? null,
      resource_id: event.resourceId ?? null,
      resource_name: event.resourceName ?? null,
      metadata: event.metadata ?? {},
    };

    const { error } = await supabaseServer.from("audit_log").insert(payload);

    if (error) {
      if (error.message?.includes("user_email")) {
        // Schema cache hasn't picked up the column yet — retry without it
        console.warn("[audit] user_email column not found, retrying without it:", error.message);
        const { user_email: _dropped, ...payloadWithoutEmail } = payload;
        const { error: retryError } = await supabaseServer.from("audit_log").insert(payloadWithoutEmail);
        if (retryError) console.error("[audit] Failed to log event (retry):", retryError.message, retryError);
      } else {
        console.error("[audit] Failed to log event:", error.message, error);
      }
    }
  } catch (e) {
    console.error("[audit] Unexpected error logging event:", e);
  }
}

export async function tryGetActor(req: NextRequest): Promise<{ userId: string | null; userEmail: string | null }> {
  const rawHeader = req.headers.get("Authorization") ?? "";
  const token = rawHeader.replace("Bearer ", "").trim();
  if (!token) {
    console.log("[audit] tryGetActor: no Authorization header — actor will be null");
    return { userId: null, userEmail: null };
  }
  try {
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (error) {
      console.error("[audit] tryGetActor: auth.getUser failed:", error.message);
      return { userId: null, userEmail: null };
    }
    console.log("[audit] tryGetActor: resolved actor", user?.id, user?.email);
    return { userId: user?.id ?? null, userEmail: user?.email ?? null };
  } catch (e) {
    console.error("[audit] tryGetActor: unexpected error:", e);
    return { userId: null, userEmail: null };
  }
}
