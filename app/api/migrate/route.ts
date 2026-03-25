import { NextRequest, NextResponse } from "next/server";

const LOOKUPTYPE_PATH = "/server/api/migration/to/lookuptype?id=";
const ENTITYFORM_BASE = "/server/api/migration/to/entityform?id=";

const STATUS = {
  SUCCESS: "success",
  PARTIAL: "partial_success",
  ERROR: "error",
} as const;

type MigrateStatus = (typeof STATUS)[keyof typeof STATUS];

interface MigrateResult {
  id: string;
  status: MigrateStatus;
  httpCode: number;
  snippet: string;
  ranAt: string;
}

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

function interpretResponse(httpCode: number, bodyText: string): Omit<MigrateResult, "id" | "ranAt"> {
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ids, migrationType, entityType, cookie, instanceUrl } = body as {
    ids: string[];
    migrationType: "lookuptype" | "entityform";
    entityType?: string;
    cookie: string;
    instanceUrl: string;
  };

  if (!cookie || !instanceUrl) {
    return NextResponse.json({ error: "Missing cookie or instanceUrl. Ensure you are logged in." }, { status: 401 });
  }
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No IDs provided." }, { status: 400 });
  }

  const base = instanceUrl.replace(/\/+$/, "");
  const headers = {
    Cookie: cookie,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  const results: MigrateResult[] = [];

  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id) continue;

    const url =
      migrationType === "lookuptype"
        ? `${base}${LOOKUPTYPE_PATH}${encodeURIComponent(id)}`
        : `${base}${ENTITYFORM_BASE}${encodeURIComponent(id)}&entity_type=${encodeURIComponent(entityType ?? "")}`;

    try {
      const response = await fetch(url, { method: "GET", headers });

      if (response.redirected && response.url.includes("login")) {
        results.push({ id, status: STATUS.ERROR, httpCode: 401, snippet: "Session expired mid-run. Re-authenticate and retry.", ranAt: new Date().toISOString() });
        continue;
      }

      const bodyText = await response.text();

      if (bodyText.includes('"state":"login"')) {
        results.push({ id, status: STATUS.ERROR, httpCode: 401, snippet: "Session expired mid-run. Re-authenticate and retry.", ranAt: new Date().toISOString() });
        continue;
      }

      const { status, httpCode, snippet } = interpretResponse(response.status, bodyText);
      results.push({ id, status, httpCode, snippet, ranAt: new Date().toISOString() });
    } catch (err) {
      results.push({ id, status: STATUS.ERROR, httpCode: 0, snippet: `Fetch error: ${String(err).slice(0, 200)}`, ranAt: new Date().toISOString() });
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return NextResponse.json({ results });
}
