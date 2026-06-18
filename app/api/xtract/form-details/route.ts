import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const REQUEST_HEADERS = {
  Accept: "text/csv, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// Detail endpoint per extraction type
const DETAIL_ENDPOINT: Record<string, string> = {
  client_forms:    "/app/iotool/form/export",
  order_forms:     "/app/iotool/form/export",
  task_forms:      "/app/iotool/form/export",
  flight_forms:    "/app/iotool/form/export",
  line_item_forms: "/app/iotool/products/export",
};

const ADFLO_ENTITY_SINGULAR: Record<string, string> = {
  order_forms:     "order",
  client_forms:    "client",
  flight_forms:    "flight",
  line_item_forms: "line_item",
};

const SECTION_NAMES_FORMS = ["form", "cluster", "placeholder", "field_groups", "fields", "field_cascading_rules", "lookup_values"];
const SECTION_NAMES_PRODUCTS = ["line_item", "cluster", "field_groups", "fields", "field_cascading_rules", "lookup_values", "flight_field_groups", "flight_fields", "flight_field_cascading_rules"];
const SECTION_NAMES_ADFLO_FORMS = ["form", "cluster", "fields", "field_cascading_rules", "lookup_values"];

const ADFLO_FORM_TYPES = new Set(["order_forms", "client_forms", "flight_forms", "line_item_forms"]);

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      current += char; i++;
    } else {
      if (char === '"') { inQuotes = true; i++; }
      else if (char === ',') { result.push(current.trim()); current = ""; i++; }
      else { current += char; i++; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseSectionedCsv(csv: string, sectionNames: string[]): Record<string, unknown[]> {
  const SEP_Q = '"----- SECTION ----- SEPARATOR -----"';
  const SEP_U = "----- SECTION ----- SEPARATOR -----";
  let sections = csv.split(SEP_Q);
  if (sections.length === 1) sections = csv.split(SEP_U);
  sections = sections.map(s => s.trim()).filter(Boolean);

  const result: Record<string, unknown[]> = {};

  sections.forEach((section, idx) => {
    const name = sectionNames[idx] ?? `section_${idx}`;
    const lines = section.split("\n")
      .map(l => l.trim())
      .map(l => (l === '"' || l === '""') ? "" : l)
      .filter(Boolean);

    if (lines.length === 0) { result[name] = []; return; }

    const headers = parseCSVLine(lines[0]);
    const records: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const record: Record<string, unknown> = {};
      headers.forEach((h, j) => {
        const raw = vals[j] ?? "";
        record[h] = raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
      });
      records.push(record);
    }

    result[name] = records;
  });

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { instanceId: string; extractionType: string; itemId: string; source?: string };
    const { instanceId, extractionType, itemId, source } = body;

    if (!instanceId || !extractionType || !itemId) {
      return NextResponse.json({ error: "Missing instanceId, extractionType, or itemId" }, { status: 400 });
    }

    const detailPath = DETAIL_ENDPOINT[extractionType];
    if (!detailPath) {
      return NextResponse.json({ error: `No detail endpoint for ${extractionType}` }, { status: 400 });
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

    // ── AdFlo code path ───────────────────────────────────────────────────────
    const entitySingular = ADFLO_ENTITY_SINGULAR[extractionType];
    if (source === 'adflo' && entitySingular) {
      const adfloUrl = `${baseUrl}/server/api/entityforms/${entitySingular}/${encodeURIComponent(itemId)}?all=true&extra=true&sql=2`;
      let adfloRes: Response;
      try {
        adfloRes = await fetch(adfloUrl, {
          method: "GET",
          headers: { ...REQUEST_HEADERS, Accept: "application/json", Cookie: cookie },
        });
      } catch (err) {
        return NextResponse.json({ error: `Network error: ${String(err).slice(0, 200)}` }, { status: 502 });
      }
      if (!adfloRes.ok) {
        return NextResponse.json({ error: `AdFlo returned HTTP ${adfloRes.status}` }, { status: 502 });
      }
      let parsed: unknown;
      try {
        parsed = await adfloRes.json();
      } catch {
        return NextResponse.json({ error: "AdFlo returned non-JSON response" }, { status: 502 });
      }
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login") {
        return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
      }
      const obj = parsed as Record<string, unknown>;
      const data = (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data))
        ? (obj.data as Record<string, unknown>)
        : obj;
      const steps = Array.isArray(data.steps) ? data.steps as Record<string, unknown>[] : [];
      const fields: unknown[] = [];
      for (const step of steps) {
        const groups = Array.isArray(step.groups) ? step.groups as Record<string, unknown>[] : [];
        for (const group of groups) {
          if (Array.isArray(group.fields)) fields.push(...(group.fields as unknown[]));
        }
      }
      return NextResponse.json({ sections: { fields }, itemId, extractionType });
    }

    // ── Classic code path ─────────────────────────────────────────────────────
    const url = `${baseUrl}${detailPath}?id=${encodeURIComponent(itemId)}`;
    let csv: string;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { ...REQUEST_HEADERS, Cookie: cookie },
      });

      if (!res.ok) {
        return NextResponse.json({ error: `TapClicks returned HTTP ${res.status}` }, { status: 502 });
      }

      csv = await res.text();
    } catch (err) {
      return NextResponse.json({ error: `Network error: ${String(err).slice(0, 200)}` }, { status: 502 });
    }

    // Detect session expiry — only flag if response looks like a login redirect, not just field data containing these words
    const csvLower = csv.toLowerCase();
    if (!csv.includes("----- SECTION ----- SEPARATOR -----")) {
      const looksLikeLoginRedirect =
        csvLower.includes('"state":"login"') ||
        csvLower.includes("'state':'login'") ||
        csvLower.includes('"redirect"') ||
        (csv.length < 200 && csvLower.includes("login"));
      if (looksLikeLoginRedirect) {
        return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
      }
      // If no separator and not a login redirect, still try to parse — may be a single-section response
    }

    const SEP_Q = '"----- SECTION ----- SEPARATOR -----"';
    const SEP_U = "----- SECTION ----- SEPARATOR -----";
    let rawSections = csv.split(SEP_Q);
    if (rawSections.length === 1) rawSections = csv.split(SEP_U);
    rawSections = rawSections.map(s => s.trim()).filter(Boolean);

    const firstSectionHeader = rawSections[0]?.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? "";
    const isAdfloResponse = ADFLO_FORM_TYPES.has(extractionType) && firstSectionHeader.includes("content_type_id");
    const sectionNames = isAdfloResponse ? SECTION_NAMES_ADFLO_FORMS
      : extractionType === "line_item_forms" ? SECTION_NAMES_PRODUCTS
      : SECTION_NAMES_FORMS;

    const sections = parseSectionedCsv(csv, sectionNames);

    return NextResponse.json({ sections, itemId, extractionType });
  } catch (err) {
    console.error("[xtract/form-details] Unhandled:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
