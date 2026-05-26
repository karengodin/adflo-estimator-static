import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { instanceId: string; lookupTypeIds: string[] };
    const { instanceId, lookupTypeIds } = body;

    if (!instanceId || !Array.isArray(lookupTypeIds) || lookupTypeIds.length === 0) {
      return NextResponse.json({ error: "Missing instanceId or lookupTypeIds" }, { status: 400 });
    }

    const { data: instance, error: instanceError } = await supabaseServer
      .from("instances")
      .select("id, name, base_url, session_cookie")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: "Instance not found" }, { status: 400 });
    }

    if (!instance.session_cookie) {
      return NextResponse.json({ error: "No session cookie for this instance" }, { status: 400 });
    }

    let baseUrl = instance.base_url as string;
    if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl;
    baseUrl = baseUrl.replace(/\/+$/, "");

    let cookie: string;
    try {
      cookie = decryptText(instance.session_cookie as string);
    } catch {
      return NextResponse.json({ error: "Failed to decrypt session cookie" }, { status: 500 });
    }

    const values: Record<string, unknown[]> = {};

    for (const id of lookupTypeIds) {
      const url = `${baseUrl}/app/iotool/lookups/values?lookupTypeId=${encodeURIComponent(id)}`;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { ...REQUEST_HEADERS, Cookie: cookie },
        });

        if (!res.ok) {
          values[id] = [];
          continue;
        }

        const text = await res.text();

        // Auth expiry check
        if (text.includes('"state":"login"') || text.includes("'state':'login'")) {
          return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
        }

        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { values[id] = []; continue; }

        // Normalise response shape — TapClicks may use different wrapper keys
        if (Array.isArray(parsed)) {
          values[id] = parsed;
        } else if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          const arr = obj.values ?? obj.lookupValues ?? obj.data ?? obj.items ?? null;
          values[id] = Array.isArray(arr) ? arr : [];
        } else {
          values[id] = [];
        }
      } catch {
        values[id] = [];
      }
    }

    return NextResponse.json({ values });
  } catch (err) {
    console.error("[xtract/lookup-values] Unhandled:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
