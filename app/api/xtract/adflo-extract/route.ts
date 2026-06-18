import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";
import { logEvent, tryGetActor } from "../../../../lib/audit";

const ADFLO_ENDPOINTS: Record<string, string> = {
  lookups:         "/server/api/contentsets?all=true&forms_in_use=min&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  client_forms:    "/server/api/entityforms/client?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  order_forms:     "/server/api/entityforms/order?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  line_item_forms: "/server/api/entityforms/line_item?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  flight_forms:    "/server/api/entityforms/flight?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
};

const REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

interface ParsedItem {
  id: string;
  name: string;
  raw: unknown;
}

async function fetchJson(url: string, cookie: string): Promise<{ parsed: unknown; error: string | null }> {
  try {
    const res = await fetch(url, { method: "GET", headers: { ...REQUEST_HEADERS, Cookie: cookie } });
    const body = await res.text();
    if (res.status < 200 || res.status >= 300) {
      return { parsed: null, error: `HTTP ${res.status}` };
    }
    try {
      return { parsed: JSON.parse(body), error: null };
    } catch {
      return { parsed: null, error: "non-JSON response" };
    }
  } catch (err) {
    return { parsed: null, error: `Network error: ${String(err).slice(0, 200)}` };
  }
}

function isLoginRedirect(parsed: unknown): boolean {
  return !!(parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login");
}

function parseList(parsed: unknown): ParsedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  let arr: unknown[] = [];

  // Adflo DataTables response: records live at data.aaData
  const dataObj = obj.data;
  if (dataObj && typeof dataObj === "object" && !Array.isArray(dataObj)) {
    const aaData = (dataObj as Record<string, unknown>).aaData;
    if (Array.isArray(aaData)) {
      arr = aaData;
    }
  }

  // Fallbacks for other shapes
  if (!arr.length) {
    for (const key of ["data", "forms", "items", "list", "content_sets"]) {
      if (Array.isArray(obj[key])) { arr = obj[key] as unknown[]; break; }
    }
  }
  if (!arr.length && Array.isArray(parsed)) arr = parsed as unknown[];
  if (!arr.length) {
    const first = Object.values(obj).find(v => Array.isArray(v));
    if (first) arr = first as unknown[];
  }
  return arr
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      const adfloId = String(f.id ?? "").trim();
      const classicId = String(f.classic_form_id ?? f.id ?? "").trim();
      return {
        id:   classicId,
        name: String(f.name ?? f.description ?? f.label ?? f.form_name ?? "").trim(),
        raw:  { ...f, adflo_id: adfloId },
      };
    })
    .filter((item) => item.id !== "");
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { instanceId: string; extractionType: string };
    const { instanceId, extractionType } = body;

    if (!instanceId || !extractionType) {
      return NextResponse.json({ error: "Missing required fields: instanceId, extractionType" }, { status: 400 });
    }
    if (!ADFLO_ENDPOINTS[extractionType]) {
      return NextResponse.json(
        { error: `Unsupported extractionType for Adflo: "${extractionType}". Valid: ${Object.keys(ADFLO_ENDPOINTS).join(", ")}` },
        { status: 400 },
      );
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

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
        { status: 400 },
      );
    }

    let baseUrl = instance.base_url as string;
    if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl;
    baseUrl = baseUrl.replace(/\/+$/, "");

    let cookie: string;
    try {
      cookie = decryptText(instance.session_cookie as string);
    } catch {
      return NextResponse.json({ error: "Failed to decrypt session cookie. Try refreshing it on the Instances page." }, { status: 500 });
    }

    // ── 1. Fetch list ─────────────────────────────────────────────────────────

    const listUrl = `${baseUrl}${ADFLO_ENDPOINTS[extractionType]}`;
    const { parsed: listParsed, error: listError } = await fetchJson(listUrl, cookie);
    if (listParsed && isLoginRedirect(listParsed)) {
      return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
    }
    if (listError || !listParsed) {
      return NextResponse.json({ error: `Failed to fetch list: ${listError ?? "empty response"}` }, { status: 502 });
    }

    const items = parseList(listParsed);

    // ── 2. Persist ────────────────────────────────────────────────────────────

    const { data: inserted, error: insertError } = await supabaseServer
      .from("extractions")
      .insert({
        instance_id: instanceId,
        entity_type: extractionType,
        item_id:     null,
        item_name:   null,
        data:        items,
        created_at:  new Date().toISOString(),
      })
      .select("id, created_at, entity_type")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ error: `Failed to save extraction: ${insertError?.message ?? "unknown"}` }, { status: 500 });
    }

    const actor = await tryGetActor(req);
    logEvent({
      ...actor,
      eventType: "extraction_run",
      resourceType: "extraction",
      resourceId: inserted.id as string,
      resourceName: instance.name as string,
      metadata: { extraction_type: extractionType, source: "adflo", record_count: items.length },
    }).catch(() => {});

    return NextResponse.json({
      id:            inserted.id,
      created_at:    inserted.created_at,
      entity_type:   extractionType,
      record_count:  items.length,
      instance_name: instance.name,
    });
  } catch (err) {
    console.error("[adflo-extract] Unhandled:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
