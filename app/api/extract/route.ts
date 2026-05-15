import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabaseServer";
import { decryptText } from "../../../lib/crypto";

// ─────────────────────────────────────────────────────────────────────────────
// PREREQUISITE SQL
//
// The migration-tables.sql that was already run added item_id, item_name, and
// reference_table to the extractions table but missed two things needed here.
// Run this once in the Supabase SQL Editor before using this route:
//
//   -- 1. Add entity_type as a plain text column (the existing extraction_type
//   --    column is a strict enum — easier to use a free-form text column here)
//   ALTER TABLE public.extractions
//     ADD COLUMN IF NOT EXISTS entity_type text;
//
//   -- 2. Unique constraint so upsert-on-conflict works
//   CREATE UNIQUE INDEX IF NOT EXISTS extractions_upsert_key
//     ON public.extractions (instance_id, entity_type, item_id)
//     WHERE item_id IS NOT NULL;
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Classic TapClicks API endpoints ─────────────────────────────────────────
//
// All paths are under /app/iotool/ (Classic OMS), not /server/api/entityforms/
// (Adflo OMS). Each endpoint includes its own query string.

const ENDPOINTS: Record<string, string> = {
  lookup_type: "/app/iotool/lookups/types?showAll=true",
  client:      "/app/iotool/form/formsByClusterId?clusterId=0&showAll=false&entityType=client",
  order:       "/app/iotool/form/formsByClusterId?clusterId=0&showAll=false&entityType=order",
  line_item:   "/app/iotool/products?showAll=yes",
  flight:      "/app/iotool/products?showAll=yes",
  task:        "/app/iotool/form/formsByClusterId?clusterId=0&showAll=false&entityType=task",
  workflow:    "/app/iotool/workflows?showAll=true",
};

const REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// ─── Response parsing ─────────────────────────────────────────────────────────

interface ExtractedItem {
  id: string;
  name: string;
  referenceTable: string | null;
  needsDetailFetch: boolean;
  raw: unknown;
}

// formsByClusterId returns { forms: { "1": {...}, "2": {...} } }
function parseFormsResponse(parsed: unknown): ExtractedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const forms = (parsed as Record<string, unknown>).forms;
  if (!forms || typeof forms !== "object" || Array.isArray(forms)) return [];
  return Object.values(forms as Record<string, unknown>)
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      const id = String(f.id ?? "").trim();
      const name = String(f.name ?? f.label ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

// lookups/types returns { lookupTypes: [...] }
function parseLookupTypes(parsed: unknown): ExtractedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).lookupTypes;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      const id = String(i.id ?? i.lookup_type_id ?? "").trim();
      const name = String(i.name ?? i.label ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

function getProductsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const arr = (parsed as Record<string, unknown>).products;
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

// products?showAll=yes — all products become line item forms
function parseProducts(parsed: unknown): ExtractedItem[] {
  return getProductsArray(parsed)
    .map((raw) => {
      const p = raw as Record<string, unknown>;
      const id = String(p.id ?? p.product_id ?? "").trim();
      const name = String(p.name ?? p.product_name ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

// products?showAll=yes — filter to products with flight_form_id + enable_flights=1,
// then deduplicate by flight_form_id
function parseFlightForms(parsed: unknown): ExtractedItem[] {
  const seen = new Set<string>();
  const result: ExtractedItem[] = [];

  for (const raw of getProductsArray(parsed)) {
    const p = raw as Record<string, unknown>;
    const flightFormId = String(p.flight_form_id ?? "").trim();
    if (!flightFormId || flightFormId === "0") continue;

    const enableFlights = p.enable_flights;
    if (!enableFlights || enableFlights === "0" || enableFlights === 0 || enableFlights === false) continue;

    if (seen.has(flightFormId)) continue;
    seen.add(flightFormId);

    const name = String(p.flight_form_name ?? p.name ?? "").trim();
    result.push({ id: flightFormId, name, referenceTable: null, needsDetailFetch: false, raw });
  }

  return result;
}

// workflows returns { workflows: [...] }
function parseWorkflows(parsed: unknown): ExtractedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).workflows;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const w = raw as Record<string, unknown>;
      const id = String(w.id ?? w.workflow_id ?? "").trim();
      const name = String(w.name ?? w.title ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

function parseResponse(entityType: string, parsed: unknown): ExtractedItem[] {
  switch (entityType) {
    case "lookup_type": return parseLookupTypes(parsed);
    case "client":
    case "order":
    case "task":        return parseFormsResponse(parsed);
    case "line_item":   return parseProducts(parsed);
    case "flight":      return parseFlightForms(parsed);
    case "workflow":    return parseWorkflows(parsed);
    default:            return [];
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    return await handleExtract(req);
  } catch (err) {
    console.error("[extract] Unhandled exception:", err);
    if (err instanceof Error) console.error("[extract] Stack:", err.stack);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function handleExtract(req: NextRequest) {
  const body = await req.json();
  const { instanceId, entityType } = body as {
    instanceId: string;
    entityType: string;
  };

  console.log(`[extract] POST instanceId=${instanceId} entityType=${entityType}`);

  // ── 1. Validate ─────────────────────────────────────────────────────────────

  if (!instanceId || !entityType) {
    return NextResponse.json(
      { error: "Missing required fields: instanceId, entityType" },
      { status: 400 }
    );
  }

  const endpoint = ENDPOINTS[entityType];
  if (!endpoint) {
    return NextResponse.json(
      {
        error: `Unknown entityType: "${entityType}". Valid values: ${Object.keys(ENDPOINTS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  // ── 2. Auth: fetch instance and decrypt cookie ───────────────────────────────

  const { data: instance, error: instanceError } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, instance_type, session_cookie")
    .eq("id", instanceId)
    .single();

  if (instanceError || !instance) {
    console.error("[extract] Instance not found:", instanceId, instanceError?.message);
    return NextResponse.json({ error: "Instance not found" }, { status: 400 });
  }

  if (!instance.base_url.startsWith("http")) {
    instance.base_url = "https://" + instance.base_url;
  }

  if (instance.instance_type === "adflo") {
    console.error(`[extract] Adflo extraction not supported: instance="${instance.name}"`);
    return NextResponse.json(
      { error: "Adflo extraction not yet supported. This instance is configured as Adflo OMS — extraction endpoints for Adflo have not been implemented." },
      { status: 400 }
    );
  }

  console.log(`[extract] Instance found: "${instance.name}" type=${instance.instance_type} base_url=${instance.base_url} hasCookie=${!!instance.session_cookie}`);

  if (!instance.session_cookie) {
    return NextResponse.json(
      {
        error: `Instance "${instance.name}" has no session cookie. Refresh it on the Instances page.`,
      },
      { status: 400 }
    );
  }

  let cookie: string;
  try {
    cookie = decryptText(instance.session_cookie);
    console.log(`[extract] Cookie decrypted OK, length=${cookie.length}`);
  } catch (err) {
    console.error("[extract] Cookie decrypt failed:", err);
    return NextResponse.json(
      { error: "Failed to decrypt session cookie. Try refreshing it on the Instances page." },
      { status: 500 }
    );
  }

  // ── 3. Call TapClicks API ────────────────────────────────────────────────────

  const base = instance.base_url.replace(/\/+$/, "");
  const url = `${base}${endpoint}`;

  console.log(`[extract] Calling TapClicks: GET ${url}`);

  let rawBody: string;
  let httpCode: number;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { ...REQUEST_HEADERS, Cookie: cookie },
    });

    httpCode = response.status;
    rawBody = await response.text();
    console.log(`[extract] TapClicks responded: HTTP ${httpCode}, body length=${rawBody.length}, preview="${rawBody.slice(0, 120)}"`);
  } catch (err) {
    console.error("[extract] Network error:", err);
    return NextResponse.json(
      { error: `Network error reaching TapClicks: ${String(err).slice(0, 200)}` },
      { status: 502 }
    );
  }

  if (httpCode < 200 || httpCode >= 300) {
    console.error(`[extract] TapClicks non-2xx: HTTP ${httpCode}, body="${rawBody.slice(0, 300)}"`);
    return NextResponse.json(
      { error: `TapClicks API returned HTTP ${httpCode}`, snippet: rawBody.slice(0, 500) },
      { status: 502 }
    );
  }

  // ── 4. Parse response ────────────────────────────────────────────────────────

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error(`[extract] Non-JSON response from TapClicks: "${rawBody.slice(0, 300)}"`);
    return NextResponse.json(
      { error: "TapClicks returned non-JSON response", snippet: rawBody.slice(0, 500) },
      { status: 502 }
    );
  }

  // Detect auth expiry (TapClicks returns 200 with state:"login" when session expires)
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).state === "login"
  ) {
    console.error("[extract] Auth expired — TapClicks returned login state");
    return NextResponse.json(
      { error: "Session expired. Refresh the session cookie on the Instances page." },
      { status: 401 }
    );
  }

  const items = parseResponse(entityType, parsed);
  console.log(`[extract] Parsed ${items.length} items for entityType=${entityType}`);

  if (items.length === 0) {
    return NextResponse.json({ count: 0, entityType, items: [] });
  }

  // ── 5. Save to extractions ───────────────────────────────────────────────────
  //
  // Delete existing rows for this instance + entity type, then insert fresh.

  const rows = items.map((item) => ({
    instance_id:     instanceId,
    entity_type:     entityType,
    item_id:         item.id,
    item_name:       item.name,
    reference_table: item.referenceTable,
    data:            item.raw,
    created_at:      new Date().toISOString(),
  }));

  console.log(`[extract] Deleting existing rows for instance=${instanceId} entityType=${entityType}`);

  const { error: deleteError } = await supabaseServer
    .from("extractions")
    .delete()
    .eq("instance_id", instanceId)
    .eq("entity_type", entityType);

  if (deleteError) {
    console.error("[extract] Delete failed:", deleteError.message, deleteError);
    return NextResponse.json(
      { error: `Failed to clear existing extractions: ${deleteError.message}` },
      { status: 500 }
    );
  }

  console.log(`[extract] Inserting ${rows.length} rows`);

  const { error: insertError } = await supabaseServer
    .from("extractions")
    .insert(rows);

  if (insertError) {
    console.error("[extract] Insert failed:", insertError.message, insertError);
    return NextResponse.json(
      { error: `Failed to save extractions: ${insertError.message}` },
      { status: 500 }
    );
  }

  console.log(`[extract] Insert OK — ${rows.length} rows saved`);

  // ── 6. Response ──────────────────────────────────────────────────────────────

  return NextResponse.json({
    count: items.length,
    entityType,
    instanceName: instance.name,
    items: items.map((item) => ({
      id:               item.id,
      name:             item.name,
      referenceTable:   item.referenceTable,
      needsDetailFetch: item.needsDetailFetch,
    })),
  });
}
