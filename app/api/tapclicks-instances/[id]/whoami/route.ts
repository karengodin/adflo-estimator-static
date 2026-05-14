import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";
import { decryptText } from "../../../../../lib/crypto";

// TapClicks endpoint candidates for "who am I", tried in order.
// The auth login lives at /app/dash/session/login; data APIs at /server/api/.
// /server/api/user/profile is the most consistent guess given those patterns.
// If none of these return a usable email the caller gets a soft error —
// the caller should treat this as non-fatal and let the user fill it in manually.
const WHOAMI_ENDPOINTS = [
  "/server/api/user/profile",
  "/server/api/user/current",
  "/server/api/user",
];

function extractEmail(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;

  // Try common shapes: { email }, { data: { email } }, { user: { email } }
  const candidate =
    p.email ??
    (p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>).email : null) ??
    (p.user && typeof p.user === "object" ? (p.user as Record<string, unknown>).email : null) ??
    null;

  return typeof candidate === "string" && candidate.includes("@") ? candidate : null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data: instance, error } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, instance_type, session_cookie")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (instance.instance_type === "adflo") {
    return NextResponse.json({ error: "Adflo instances not yet supported" }, { status: 400 });
  }

  if (!instance.session_cookie) {
    return NextResponse.json({ error: "No session cookie stored for this instance" }, { status: 400 });
  }

  let cookie: string;
  try {
    cookie = decryptText(instance.session_cookie);
  } catch {
    return NextResponse.json({ error: "Failed to decrypt session cookie" }, { status: 500 });
  }

  const base = instance.base_url.startsWith("http")
    ? instance.base_url.replace(/\/+$/, "")
    : "https://" + instance.base_url.replace(/\/+$/, "");

  const headers = {
    Cookie: cookie,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  for (const path of WHOAMI_ENDPOINTS) {
    const url = `${base}${path}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue; // 404, 403, etc. — try next endpoint

      const text = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { continue; }

      // Session-expired check (TapClicks returns 200 with state:"login")
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login") {
        return NextResponse.json({ error: "Session expired — refresh the cookie first" }, { status: 401 });
      }

      const email = extractEmail(parsed);
      if (email) {
        console.log(`[whoami] Found email via ${path}: ${email}`);
        return NextResponse.json({ email, resolvedVia: path });
      }
    } catch {
      // Network error on this endpoint — try next
      continue;
    }
  }

  return NextResponse.json(
    { error: `Could not find user email from any known endpoint (tried: ${WHOAMI_ENDPOINTS.join(", ")})` },
    { status: 404 }
  );
}
