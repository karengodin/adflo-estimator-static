import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabaseServer";
import { decryptText } from "../../../lib/crypto";

// ─── URL paths (unchanged from original) ─────────────────────────────────────

const LOOKUPTYPE_PATH = "/server/api/migration/to/lookuptype?id=";
const ENTITYFORM_BASE = "/server/api/migration/to/entityform?id=";

// ─── Status enum ──────────────────────────────────────────────────────────────
//
// Added: skipped (prior success found), needs_parent_selection (task form
// ambiguity). These two never reach the TapClicks API.

const STATUS = {
  SUCCESS: "success",
  PARTIAL: "partial_success",
  ERROR: "error",
  SKIPPED: "skipped",
  NEEDS_PARENT: "needs_parent_selection",
} as const;

type MigrateStatus = (typeof STATUS)[keyof typeof STATUS];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemInput {
  id: string;
  name: string;
  // For task forms, the entity type(s) this form belongs to.
  // Single value ("order") → auto-proceed.
  // Comma-separated ("order,flight") → needs_parent_selection.
  referenceTable?: string | null;
}

interface MigrateResult {
  id: string;
  name: string;
  status: MigrateStatus;
  httpCode: number;
  snippet: string;
  requestUrl: string;
  ranAt: string;
  isRetry: boolean;
}

// ─── Response interpretation (UNCHANGED from original) ────────────────────────
//
// These functions were ported directly from the AppScript and are correct.
// Do not modify them.

function extractErrors(parsed: unknown): string[] {
  const out: string[] = [];
  if (!parsed || typeof parsed !== "object") return out;
  const p = parsed as Record<string, unknown>;
  if (Array.isArray(p.errors)) out.push(...p.errors.map(String));
  if (p.data && typeof p.data === "object") {
    const d = p.data as Record<string, unknown>;
    if (Array.isArray(d.errors)) out.push(...d.errors.map(String));
    if (typeof d.error === "string" && d.error.trim()) out.push(d.error.trim());
    if (Array.isArray(d.warnings)) out.push(...d.warnings.map((w) => `WARN: ${w}`));
  }
  if (typeof p.error === "string" && p.error.trim()) out.push(p.error.trim());
  if (Array.isArray(p.warnings)) out.push(...p.warnings.map((w) => `WARN: ${w}`));
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

function errorsAreOnlyUnsupportedFieldType(errors: string[]): boolean {
  const re = /^Tap Projects does not support field type\s+\w+\s+\(found in field\s+.+\)$/i;
  return errors.every((e) => re.test(String(e || "").trim()));
}

function extractAddedCounts(parsed: unknown): { foundAnyCount: boolean; totalAdded: number } {
  let foundAnyCount = false;
  let totalAdded = 0;
  const scan = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k.toLowerCase().includes("number of") && k.toLowerCase().includes("added")) {
        foundAnyCount = true;
        const val = Number(v);
        if (!isNaN(val)) totalAdded += val;
      }
    }
  };
  scan(parsed);
  if (parsed && typeof parsed === "object") scan((parsed as Record<string, unknown>).data);
  return { foundAnyCount, totalAdded };
}

function interpretResponse(httpCode: number, bodyText: string): Omit<MigrateResult, "id" | "name" | "requestUrl" | "ranAt" | "isRetry"> {
  const snippet = bodyText.slice(0, 500);
  if (httpCode < 200 || httpCode >= 300) return { status: STATUS.ERROR, httpCode, snippet };
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed?.state === "login") {
      return { status: STATUS.ERROR, httpCode: 401, snippet: `Auth expired: ${parsed.message || "Login required"}` };
    }
    const errors = extractErrors(parsed);
    if (errors.length) {
      if (errorsAreOnlyUnsupportedFieldType(errors)) {
        return { status: STATUS.PARTIAL, httpCode, snippet: `PARTIAL: ${errors.slice(0, 3).join(" | ")}`.slice(0, 500) };
      }
      return { status: STATUS.ERROR, httpCode, snippet: `ERRORS: ${errors.slice(0, 3).join(" | ")}`.slice(0, 500) };
    }
    if (parsed?.error === true || parsed?.is_error === true) {
      return { status: STATUS.ERROR, httpCode, snippet: `ERROR FLAG TRUE. ${JSON.stringify(parsed).slice(0, 450)}` };
    }
    const { foundAnyCount, totalAdded } = extractAddedCounts(parsed);
    if (foundAnyCount) {
      return totalAdded > 0
        ? { status: STATUS.SUCCESS, httpCode, snippet: `OK: added ${totalAdded} items` }
        : { status: STATUS.ERROR, httpCode, snippet: `NO-OP: 0 items added` };
    }
    return { status: STATUS.SUCCESS, httpCode, snippet };
  } catch {
    return { status: STATUS.SUCCESS, httpCode, snippet };
  }
}

// ─── URL builder ──────────────────────────────────────────────────────────────
//
// Lookup types use a different path from all entity form types.

function buildUrl(base: string, entityType: string, id: string): string {
  if (entityType === "lookup_type") {
    return `${base}${LOOKUPTYPE_PATH}${encodeURIComponent(id)}`;
  }
  return `${base}${ENTITYFORM_BASE}${encodeURIComponent(id)}&entity_type=${encodeURIComponent(entityType)}`;
}

// ─── Prior-success check ──────────────────────────────────────────────────────
//
// Used by pendingOnly mode. Checks migration_runs for any row where this
// instance + entity type + item_id previously completed with status=success.
// If found, the item is marked skipped and the API is not called.

async function hasPriorSuccess(
  instanceId: string,
  entityType: string,
  itemId: string
): Promise<boolean> {
  const { data } = await supabaseServer
    .from("migration_runs")
    .select("id")
    .eq("instance_id", instanceId)
    .eq("entity_type", entityType)
    .eq("item_id", itemId)
    .eq("status", STATUS.SUCCESS)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ─── Persistence ──────────────────────────────────────────────────────────────
//
// Writes one row to migration_runs for each item after it completes (or is
// skipped / blocked). Called immediately after each item so partial runs are
// recoverable even if the request times out mid-batch.

async function persistResult(
  instanceId: string,
  entityType: string,
  item: ItemInput,
  result: Pick<MigrateResult, "status" | "httpCode" | "snippet" | "requestUrl" | "ranAt">,
  isRetry: boolean
): Promise<void> {
  await supabaseServer.from("migration_runs").insert({
    instance_id: instanceId,
    entity_type: entityType,
    item_id: item.id,
    item_name: item.name,
    status: result.status,
    http_code: result.httpCode,
    snippet: result.snippet,
    request_url: result.requestUrl,
    run_at: result.ranAt,
    is_retry: isRetry,
  });
}

// ─── Single-item fetch ────────────────────────────────────────────────────────
//
// Shared by both the main pass and the retry pass. Returns a complete
// MigrateResult for one item. Does not write to the database.

async function fetchItem(
  url: string,
  headers: Record<string, string>,
  item: ItemInput,
  isRetry: boolean
): Promise<MigrateResult> {
  try {
    const response = await fetch(url, { method: "GET", headers });

    // Some instances redirect to /login on session expiry instead of returning JSON.
    if (response.redirected && response.url.toLowerCase().includes("login")) {
      return {
        id: item.id,
        name: item.name,
        status: STATUS.ERROR,
        httpCode: 401,
        snippet: "Session expired — redirected to login. Re-authenticate on the Instances page.",
        requestUrl: url,
        ranAt: new Date().toISOString(),
        isRetry,
      };
    }

    const bodyText = await response.text();

    // Others return a JSON payload with state:"login" instead of redirecting.
    if (bodyText.includes('"state":"login"')) {
      return {
        id: item.id,
        name: item.name,
        status: STATUS.ERROR,
        httpCode: 401,
        snippet: "Session expired — login state in response. Re-authenticate on the Instances page.",
        requestUrl: url,
        ranAt: new Date().toISOString(),
        isRetry,
      };
    }

    const { status, httpCode, snippet } = interpretResponse(response.status, bodyText);
    return {
      id: item.id,
      name: item.name,
      status: status as MigrateStatus,
      httpCode,
      snippet,
      requestUrl: url,
      ranAt: new Date().toISOString(),
      isRetry,
    };
  } catch (err) {
    return {
      id: item.id,
      name: item.name,
      status: STATUS.ERROR,
      httpCode: 0,
      snippet: `Network error: ${String(err).slice(0, 200)}`,
      requestUrl: url,
      ranAt: new Date().toISOString(),
      isRetry,
    };
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    instanceId,
    entityType,
    items,
    pendingOnly = false,
  } = body as {
    instanceId: string;
    entityType: string;
    items: ItemInput[];
    pendingOnly?: boolean;
  };

  // ── 1. Validate request shape ──────────────────────────────────────────────

  if (!instanceId || !entityType) {
    return NextResponse.json(
      { error: "Missing required fields: instanceId, entityType" },
      { status: 400 }
    );
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  }

  // ── 2. Auth: look up instance, decrypt cookie ──────────────────────────────
  //
  // The session cookie is never passed from the browser. We fetch it
  // server-side from the instances table and decrypt it here.

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
      { error: `Instance "${instance.name}" has no session cookie. Refresh it on the Instances page.` },
      { status: 400 }
    );
  }

  let cookie: string;
  try {
    cookie = decryptText(instance.session_cookie);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt session cookie. It may be corrupt — try refreshing it." },
      { status: 500 }
    );
  }

  const base = instance.base_url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Cookie: cookie,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  // ── 3. Main pass ───────────────────────────────────────────────────────────

  const results: MigrateResult[] = [];
  let authExpired = false; // stop early if session dies mid-run

  for (const item of items) {
    const id = item.id.trim();
    if (!id) continue;

    // Stop processing if auth expired in a previous iteration — there's no
    // point hammering the API with more requests that will all fail the same way.
    if (authExpired) {
      const result: MigrateResult = {
        id,
        name: item.name,
        status: STATUS.ERROR,
        httpCode: 401,
        snippet: "Skipped — session expired earlier in this run.",
        requestUrl: "",
        ranAt: new Date().toISOString(),
        isRetry: false,
      };
      results.push(result);
      await persistResult(instanceId, entityType, item, result, false);
      continue;
    }

    // ── Task form parent ambiguity check ────────────────────────────────────
    //
    // If a task form references multiple entity types we can't auto-assign a
    // parent. Block the item and surface it to the user for manual resolution.

    if (entityType === "task") {
      const refs = (item.referenceTable ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (refs.length > 1) {
        const result: MigrateResult = {
          id,
          name: item.name,
          status: STATUS.NEEDS_PARENT,
          httpCode: 0,
          snippet: `References multiple entity types: ${refs.join(", ")}. Choose one or duplicate the form.`,
          requestUrl: "",
          ranAt: new Date().toISOString(),
          isRetry: false,
        };
        results.push(result);
        // Persist so the UI can display this state across sessions.
        await persistResult(instanceId, entityType, item, result, false);
        continue;
      }
    }

    // ── Skipped check (pendingOnly mode) ────────────────────────────────────
    //
    // Only skip when the caller explicitly requested pendingOnly. When running
    // "all rows" we re-run everything regardless of history.

    if (pendingOnly) {
      const alreadyDone = await hasPriorSuccess(instanceId, entityType, id);
      if (alreadyDone) {
        results.push({
          id,
          name: item.name,
          status: STATUS.SKIPPED,
          httpCode: 0,
          snippet: "Already succeeded in a previous run — skipped.",
          requestUrl: "",
          ranAt: new Date().toISOString(),
          isRetry: false,
        });
        // Skipped items are not persisted — they already have a success row.
        continue;
      }
    }

    // ── Call the API ────────────────────────────────────────────────────────

    const url = buildUrl(base, entityType, id);
    const result = await fetchItem(url, headers, item, false);

    if (result.httpCode === 401) authExpired = true;

    results.push(result);
    await persistResult(instanceId, entityType, item, result, false);

    await new Promise((r) => setTimeout(r, 200));
  }

  // ── 4. Retry pass ─────────────────────────────────────────────────────────
  //
  // After the full pass, retry items that errored with a NO-OP ("0 items
  // added"). These are typically parent/child dependency failures — e.g. a
  // form failed because its lookup types hadn't been migrated yet. A second
  // attempt after the full batch often succeeds.
  //
  // Auth-expired items and real errors (non-2xx, parse errors) are NOT
  // retried — they need human attention.

  if (!authExpired) {
    const retryTargets = results.filter(
      (r) =>
        !r.isRetry &&
        r.status === STATUS.ERROR &&
        (r.snippet.includes("NO-OP") || r.snippet.toLowerCase().includes("0 items added"))
    );

    for (const original of retryTargets) {
      const item = items.find((i) => i.id.trim() === original.id);
      if (!item) continue;

      const url = buildUrl(base, entityType, original.id);
      const retryResult = await fetchItem(url, headers, item, true);

      if (retryResult.httpCode === 401) authExpired = true;

      results.push(retryResult);
      await persistResult(instanceId, entityType, item, retryResult, true);

      if (authExpired) break;

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ── 5. Response ────────────────────────────────────────────────────────────
  //
  // Return all rows: main pass + retry pass. Each row has isRetry flag so the
  // UI can display them separately. The UI should use the latest row per item
  // (highest ranAt) as the current status.

  return NextResponse.json({ results });
}
