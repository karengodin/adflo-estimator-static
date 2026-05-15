import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// Entity types that query per-cluster and merge results.
// lookup_type and workflow have no cluster dimension.
const CLUSTER_AWARE = new Set(["client", "order", "task", "line_item", "flight"]);

// Fixed single-endpoint types
const FIXED_ENDPOINTS: Record<string, string> = {
  lookup_type: "/app/iotool/lookups/types?showAll=true",
  workflow:    "/app/iotool/workflows?showAll=true",
};

const VALID_ENTITY_TYPES = [...CLUSTER_AWARE, ...Object.keys(FIXED_ENDPOINTS)];

// ─── URL builders ─────────────────────────────────────────────────────────────

function buildClusterUrl(entityType: string, clusterId: string | number): string {
  if (entityType === "line_item" || entityType === "flight") {
    return `/app/iotool/products?clusterId=${clusterId}&showAll=yes`;
  }
  return `/app/iotool/form/formsByClusterId?clusterId=${clusterId}&showAll=false&entityType=${entityType}`;
}

// ─── Parsers — each returns [{id, name}] ─────────────────────────────────────

type ClassicItem = { id: string; name: string };

// /app/iotool/lookups/types → { lookupTypes: [...] }
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

// /app/iotool/form/formsByClusterId → { forms: { "1": {...}, "2": {...} } }
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

// /app/iotool/products → all products as line item forms
function parseProducts(parsed: unknown): ClassicItem[] {
  return getProductsArray(parsed)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { id: String(r.id ?? r.product_id ?? "").trim(), name: String(r.name ?? r.product_name ?? "").trim() };
    })
    .filter((i) => i.id !== "");
}

// /app/iotool/products → deduplicate by flight_form_id, filter enable_flights
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

// /app/iotool/workflows → { workflows: [...] }
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

function parseClusterResponse(entityType: string, parsed: unknown): ClassicItem[] {
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

// ─── Multi-cluster helpers ────────────────────────────────────────────────────

function isSessionExpired(parsed: unknown): boolean {
  return !!(parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login");
}

// Fetch and parse JSON from a Classic endpoint. Returns null on any failure
// (network error, non-2xx, non-JSON) — callers skip null results silently.
async function fetchJSON(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// GET /app/iotool/clusters — returns all cluster IDs excluding 0.
// Response shape is unknown; we try the three most common variants.
async function fetchClusterIds(base: string, headers: Record<string, string>): Promise<string[]> {
  const parsed = await fetchJSON(`${base}/app/iotool/clusters`, headers);
  if (!parsed) return [];

  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>).clusters)
      ? (parsed as Record<string, unknown>).clusters as unknown[]
      : Array.isArray((parsed as Record<string, unknown>).data)
        ? (parsed as Record<string, unknown>).data as unknown[]
        : [];

  return arr
    .map((c) => String((c as Record<string, unknown>).id ?? (c as Record<string, unknown>).cluster_id ?? "").trim())
    .filter((id) => id && id !== "0");
}

// Deduplicate by id, keeping the first occurrence (clusterId=0 items win).
function deduplicateById(items: ClassicItem[]): ClassicItem[] {
  const seen = new Set<string>();
  return items.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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
  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json(
      { error: `Unknown entityType: "${entityType}". Valid: ${VALID_ENTITY_TYPES.join(", ")}` },
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

  const base = (instance.base_url.startsWith("http") ? instance.base_url : "https://" + instance.base_url).replace(/\/+$/, "");
  const headers = { ...REQUEST_HEADERS, Cookie: cookie };

  // ── Non-cluster-aware types: single fetch ─────────────────────────────────

  if (!CLUSTER_AWARE.has(entityType)) {
    const url = `${base}${FIXED_ENDPOINTS[entityType]}`;
    const parsed = await fetchJSON(url, headers);

    if (parsed === null) {
      return NextResponse.json({ error: "Failed to reach Classic instance" }, { status: 502 });
    }
    if (isSessionExpired(parsed)) {
      return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
    }

    return NextResponse.json(parseClusterResponse(entityType, parsed));
  }

  // ── Cluster-aware types: fetch clusters, then fetch all in parallel ────────
  //
  // Step 1: get all cluster IDs (excludes 0 = "All Business Units")
  const clusterIds = await fetchClusterIds(base, headers);

  // Step 2: build the full set of clusterIds to query: [0, ...clusterIds]
  const allClusterIds = ["0", ...clusterIds];

  // Step 3: fetch all clusters in parallel
  const clusterResults = await Promise.all(
    allClusterIds.map(async (clusterId) => {
      const url = `${base}${buildClusterUrl(entityType, clusterId)}`;
      const parsed = await fetchJSON(url, headers);
      if (parsed === null) return [];
      // If any cluster returns session-expired, surface it (we'll detect below)
      if (isSessionExpired(parsed)) return { expired: true } as unknown as ClassicItem[];
      return parseClusterResponse(entityType, parsed);
    })
  );

  // Surface session expiry if any cluster hit it
  if (clusterResults.some((r) => !Array.isArray(r) && (r as unknown as { expired: boolean }).expired)) {
    return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
  }

  // Step 4: combine all results, deduplicate by id (clusterId=0 items win)
  const combined = deduplicateById((clusterResults as ClassicItem[][]).flat());

  return NextResponse.json(combined);
}
