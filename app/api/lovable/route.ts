// app/api/lovable/route.ts
// Proxies requests to Lovable edge functions using the service role key.
// The service key never leaves the server.

import { NextRequest, NextResponse } from "next/server";

const LOVABLE_URL = process.env.LOVABLE_SUPABASE_URL;
const SERVICE_KEY = process.env.LOVABLE_SERVICE_ROLE_KEY;

async function callLovable(fn: string, body: unknown) {
  if (!LOVABLE_URL || !SERVICE_KEY) {
    throw new Error("Lovable environment variables are not configured.");
  }

  const res = await fetch(`${LOVABLE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || `Lovable function error (${res.status})`);
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fn, ...payload } = body;

    if (!fn || typeof fn !== "string") {
      return NextResponse.json({ error: "Missing function name" }, { status: 400 });
    }

    // Allowlist — only permit safe function names
    const allowed = ["manage-instance", "test-connection"];
    if (!allowed.includes(fn)) {
      return NextResponse.json({ error: "Function not permitted" }, { status: 403 });
    }

    const data = await callLovable(fn, payload);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/lovable]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
