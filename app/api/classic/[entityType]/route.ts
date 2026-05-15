import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

// ─── Classic TapClicks endpoints (same paths as extract/route.ts) ─────────────

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

// ─── Parsers — each returns a flat [{id, name}] list ─────────────────────────

type ClassicItem = { id: string; name: string };

// GET /app/iotool/lookups/types → { lookupTypes: [...] }
function parseLookupTypes(parsed: unknown): ClassicItem[] {
  const arr = (parsed as Record<string, unknown>)?.lookupTypes;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { id: String(r.id ?? r.lookup_type_id ?? "").trim(), name: String(r.name ?? r.label ?? "").trim() };
    })
    .filter((i) => i.id !== "");
}

// GET /app/iotool/form/formsByClusterId → { forms: { "1": {...}, "2": {...} } }
function parseFormsResponse(parsed: unknown): ClassicItem[] {
  const forms = (parsed as Record<string, unknown>)?.forms;
  if (!forms || typeof forms !== "object" || Array.isArray(forms)) return [];
  return Object.values(forms as Record<string, unknown>)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { id: String(r.id ?? "").trim(), name: String(r.name ?? r.label ?? "").trim() };
    })
    .filter((i) => i.id !== "");
}

function getProductsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const arr = (parsed as Record<string, unknown>)?.products;
  return Array.isArray(arr) ? arr : [];
}

// GET /app/iotool/products → all products as line item forms
function parseProducts(parsed: unknown): ClassicItem[] {
  return getProductsArray(parsed)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { id: String(r.id ?? r.product_id ?? "").trim(), name: String(r.name ?? r.product_name ?? "").trim() };
    })
    .filter((i) => i.id !== "");
}

// GET /app/iotool/products → filter flight forms, deduplicate by flight_form_id
function parseFlightForms(parsed: unknown): ClassicItem[] {
  const seen = new Set<string>();
  const result: ClassicItem[] = [];
  for (const raw of getProductsArray(parsed)) {
    const r = raw as Record<string, unknown>;
    const flightFormId = String(r.flight_form_id ?? "").trim();
    if (!flightFormId || flightFormId === "0") continue;
    const enableFlights = r.enable_flights;
    if (!enableFlights || enableFlights === "0" || enableFlights === 0 || enableFlights === false) continue;
    if (seen.has(flightFormId)) continue;
    seen.add(flightFormId);
    const productName = String(r.name ?? r.product_name ?? "").trim();
    result.push({ id: flightFormId, name: productName ? `${productName} (Flight)` : `Flight Form ${flightFormId}` });
  }
  return result;
}

// GET /app/iotool/workflows → { workflows: [...] }
function parseWorkflows(parsed: unknown): ClassicItem[] {
  const arr = (parsed as Record<string, unknown>)?.workflows;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { id: String(r.id ?? r.workflow_id ?? "").trim(), name: String(r.name ?? r.title ?? "").trim() };
    })
    .filter((i) => i.id !== "");
}

function parseResponse(entityType: string, parsed: unknown): ClassicItem[] {
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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ entityType: string }> }
) {
  const { entityType } = await context.params;
  const instanceId = req.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
  }

  const endpoint = ENDPOINTS[entityType];
  if (!endpoint) {
    return NextResponse.json(
      { error: `Unknown entityType: "${entityType}". Valid: ${Object.keys(ENDPOINTS).join(", ")}` },
      { status: 400 }
    );
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const { data: instance, error: instanceError } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, session_cookie")
    .eq("id", instanceId)
    .single();

  if (instanceError || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (!instance.session_cookie) {
    return NextResponse.json(
      { error: `Instance "${instance.name}" has no session cookie. Refresh it on the Instances page.` },
      { status: 400 }
    );
  }

  let cookie: string;
  try {
    cookie = decryptText(instance.session_cookie);
  } catch {
    return NextResponse.json({ error: "Failed to decrypt session cookie." }, { status: 500 });
  }

  // ── Fetch from Classic ────────────────────────────────────────────────────

  const base = (instance.base_url.startsWith("http") ? instance.base_url : "https://" + instance.base_url).replace(/\/+$/, "");
  const url = `${base}${endpoint}`;

  let rawBody: string;
  let httpCode: number;
  try {
    const res = await fetch(url, { headers: { ...REQUEST_HEADERS, Cookie: cookie } });
    httpCode = res.status;
    rawBody = await res.text();
  } catch (err) {
    return NextResponse.json({ error: `Network error: ${String(err).slice(0, 200)}` }, { status: 502 });
  }

  if (httpCode < 200 || httpCode >= 300) {
    return NextResponse.json({ error: `TapClicks returned HTTP ${httpCode}` }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "TapClicks returned non-JSON response" }, { status: 502 });
  }

  if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login") {
    return NextResponse.json(
      { error: "Session expired. Refresh the cookie on the Instances page." },
      { status: 401 }
    );
  }

  const items = parseResponse(entityType, parsed);
  return NextResponse.json(items);
}
