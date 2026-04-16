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

// ─── Entity type → TapClicks API endpoint ────────────────────────────────────
//
// These paths are based on the AppScript and AppScript test URLs.
// ASSUMPTION: all endpoints are GET and live under /server/api/.
// Verify paths against the actual TapClicks instance if any return 404.

const ENDPOINTS: Record<string, string> = {
  lookup_type: "/server/api/lookuptype/list",
  client:      "/server/api/entityforms/client",
  order:       "/server/api/entityforms/order",
  line_item:   "/server/api/entityforms/line_item",
  flight:      "/server/api/entityforms/flight",
  task:        "/server/api/entityforms/task",
  workflow:    "/server/api/workflow/list",
};

// ASSUMPTION: appending ?all=true returns the full unpaginated list on all
// endpoints. If any endpoint paginates, this will silently return a partial
// result. Verify against real data for large instances.
const QUERY_SUFFIX = "?all=true";

// ─── Response parsing ─────────────────────────────────────────────────────────
//
// Each parser converts a raw API response into a normalised ExtractedItem[].
// Every ASSUMPTION below is a place to verify against real TapClicks data.

interface ExtractedItem {
  id: string;
  name: string;
  referenceTable: string | null;
  needsDetailFetch: boolean; // true when reference_table couldn't be resolved from the list response
  raw: unknown; // stored as-is in the data (jsonb) column
}

// ASSUMPTION: All endpoints wrap their list under a `data` key.
// Fallbacks to bare array, `items`, or `results` cover common alternatives.
function getDataArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (Array.isArray(p.data))    return p.data;
    if (Array.isArray(p.items))   return p.items;
    if (Array.isArray(p.results)) return p.results;
  }
  return [];
}

// ASSUMPTION: Lookup type items have numeric `id` and string `name`.
// Possible alternative: `lookup_type_id` instead of `id`.
function parseLookupTypes(parsed: unknown): ExtractedItem[] {
  return getDataArray(parsed)
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      const id = String(i.id ?? i.lookup_type_id ?? "").trim();
      const name = String(i.name ?? i.label ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

// ASSUMPTION: Entity form items (client/order/line_item/flight) have numeric
// `id` and a string `name`. Possible alternative name fields: `label`, `title`.
// The full raw item is stored in data (jsonb) so nothing is lost even if the
// name field turns out to be different.
function parseEntityForms(parsed: unknown): ExtractedItem[] {
  return getDataArray(parsed)
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      const id = String(i.id ?? "").trim();
      const name = String(i.name ?? i.label ?? i.title ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

// Task forms additionally capture reference_table — the parent entity type
// that this task form is attached to (e.g. "order", "flight", "line_item").
// This is used by the migration route to detect parent-ambiguity.
//
// Confirmed path: reference_table lives at cluster[0].reference_table in the
// detailed single-form response (GET /server/api/entityforms/task/{id}?all=true).
// Whether the list endpoint exposes it at the top level is unverified — we try
// the most likely field names and fall back gracefully.
//
// If reference_table is missing or empty after all fallbacks, needsDetailFetch
// is set to true. The caller can use this flag to decide whether to fire the
// per-item detail fetch to resolve it.
//
// FOLLOW-UP IMPROVEMENT (N+1 fetch):
//   For items where needsDetailFetch=true, fetch each individually:
//     GET /server/api/entityforms/task/{id}?all=true
//   Then read: response.data.clusters[0].reference_table
//   This is confirmed from the AppScript's getTaskFormForUpdate_ function which
//   reads response.data.parent_form_name.entity_type — check both paths against
//   real data to confirm which one holds the value you need.
//   Doing this inline would be N+1 calls on the extraction, so it's better
//   handled as a separate enrichment step in the UI after the initial extract.
function parseTaskForms(parsed: unknown): ExtractedItem[] {
  return getDataArray(parsed)
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      const id = String(i.id ?? "").trim();
      const name = String(i.name ?? i.label ?? i.title ?? "").trim();

      // Try top-level list fields first. If the list response does include
      // reference_table, one of these will catch it.
      // If it's a comma/multi-value string, keep it as-is — the migration route
      // will detect multiple values and surface needs_parent_selection.
      const refRaw =
        i.reference_table ??       // confirmed field name from detail response
        i.entity_type ??           // possible alias in list response
        i.parent_entity_type ??    // another possible alias
        null;
      const referenceTable = refRaw ? String(refRaw).trim() || null : null;

      // Flag items where we couldn't resolve reference_table from the list.
      // The UI can surface these for a follow-up detail fetch.
      const needsDetailFetch = referenceTable === null;

      return { id, name, referenceTable, needsDetailFetch, raw };
    })
    .filter((item) => item.id !== "");
}

// ASSUMPTION: Workflow list returns items with numeric `id` and string `name`.
// Possible alternative: `workflow_id`, `title`.
function parseWorkflows(parsed: unknown): ExtractedItem[] {
  return getDataArray(parsed)
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      const id = String(i.id ?? i.workflow_id ?? "").trim();
      const name = String(i.name ?? i.label ?? i.title ?? "").trim();
      return { id, name, referenceTable: null, needsDetailFetch: false, raw };
    })
    .filter((item) => item.id !== "");
}

function parseResponse(entityType: string, parsed: unknown): ExtractedItem[] {
  if (entityType === "lookup_type") return parseLookupTypes(parsed);
  if (entityType === "task")        return parseTaskForms(parsed);
  if (entityType === "workflow")    return parseWorkflows(parsed);
  return parseEntityForms(parsed); // client, order, line_item, flight
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { instanceId, entityType } = body as {
    instanceId: string;
    entityType: string;
  };

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
  //
  // Same pattern as the migrate route — cookie never comes from the browser.

  const { data: instance, error: instanceError } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, session_cookie")
    .eq("id", instanceId)
    .single();

  if (instanceError || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 400 });
  }
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
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt session cookie. Try refreshing it on the Instances page." },
      { status: 500 }
    );
  }

  // ── 3. Call TapClicks API ────────────────────────────────────────────────────

  const base = instance.base_url.replace(/\/+$/, "");
  const url = `${base}${endpoint}${QUERY_SUFFIX}`;

  let rawBody: string;
  let httpCode: number;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    httpCode = response.status;
    rawBody = await response.text();
  } catch (err) {
    return NextResponse.json(
      { error: `Network error reaching TapClicks: ${String(err).slice(0, 200)}` },
      { status: 502 }
    );
  }

  if (httpCode < 200 || httpCode >= 300) {
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
    return NextResponse.json(
      { error: "Session expired. Refresh the session cookie on the Instances page." },
      { status: 401 }
    );
  }

  const items = parseResponse(entityType, parsed);

  if (items.length === 0) {
    // Not necessarily an error — the instance may genuinely have no items of
    // this type. Return success with count 0 so the UI can show "nothing found"
    // rather than a confusing error state.
    return NextResponse.json({ count: 0, entityType, items: [] });
  }

  // ── 5. Upsert to extractions ─────────────────────────────────────────────────
  //
  // Each item gets its own row. Upsert on (instance_id, entity_type, item_id)
  // so re-running a extraction refreshes existing rows instead of duplicating.
  //
  // Requires the unique index created in the PREREQUISITE SQL at the top of
  // this file. If that index doesn't exist yet, this call will insert instead
  // of upsert (Supabase falls back to insert when the conflict target is missing).
  //
  // `created_at` is set explicitly so it reflects the time of THIS extraction
  // run, not the original insertion time. This is our `extracted_at` timestamp.

  const rows = items.map((item) => ({
    instance_id:     instanceId,
    entity_type:     entityType,
    item_id:         item.id,
    item_name:       item.name,
    reference_table: item.referenceTable,
    data:            item.raw,
    created_at:      new Date().toISOString(),
  }));

  const { error: upsertError } = await supabaseServer
    .from("extractions")
    .upsert(rows, { onConflict: "instance_id,entity_type,item_id" });

  if (upsertError) {
    return NextResponse.json(
      { error: `Failed to save extractions: ${upsertError.message}` },
      { status: 500 }
    );
  }

  // ── 6. Response ──────────────────────────────────────────────────────────────
  //
  // Return a lightweight summary. The full item list is included so the UI can
  // populate the item picker immediately without a second round-trip to Supabase.

  const needsDetailFetchCount = items.filter((i) => i.needsDetailFetch).length;

  return NextResponse.json({
    count: items.length,
    entityType,
    instanceName: instance.name,
    // For task forms: how many items are missing reference_table and need
    // a follow-up detail fetch to resolve it.
    needsDetailFetchCount: entityType === "task" ? needsDetailFetchCount : 0,
    items: items.map((item) => ({
      id:               item.id,
      name:             item.name,
      referenceTable:   item.referenceTable,
      needsDetailFetch: item.needsDetailFetch,
    })),
  });
}
