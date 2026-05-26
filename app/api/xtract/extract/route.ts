import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const UI_TYPE_TO_ENTITY: Record<string, string> = {
  lookups:         "lookup_type",
  client_forms:    "client",
  order_forms:     "order",
  task_forms:      "task",
  line_item_forms: "line_item",
  flight_forms:    "flight",
};

// Old UI lookup endpoint (form types are fetched per-cluster via fetchFormsByAllClusters)
const OLD_UI_LOOKUP_ENDPOINT = "/app/iotool/lookups/types?showAll=true";

// New UI (Adflo OMS) endpoints — primary for these four types; returns all forms across all BUs
const NEW_UI_ENDPOINTS: Partial<Record<string, string>> = {
  client_forms:    "/server/api/entityforms/client?all=true&entity_type=client&entities_in_use=min&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  order_forms:     "/server/api/entityforms/order?all=true&entity_type=order&entities_in_use=min&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  line_item_forms: "/server/api/entityforms/line_item?all=true&entity_type=line_item&entities_in_use=min&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
  flight_forms:    "/server/api/entityforms/flight?all=true&entity_type=flight&entities_in_use=min&datatable=true&summary=true&page=0,1000&is_template=false&sql=2",
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
  bu_names?: string[];
  is_active?: boolean;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseLookupTypes(parsed: unknown): ParsedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).lookupTypes;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      return { id: String(i.id ?? i.lookup_type_id ?? "").trim(), name: String(i.name ?? i.label ?? "").trim(), raw };
    })
    .filter((item) => item.id !== "");
}

function parseOldUiFormsResponse(parsed: unknown): ParsedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const forms = (parsed as Record<string, unknown>).forms;
  if (!forms || typeof forms !== "object" || Array.isArray(forms)) return [];
  return Object.values(forms as Record<string, unknown>)
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      return { id: String(f.id ?? "").trim(), name: String(f.name ?? f.label ?? "").trim(), raw };
    })
    .filter((item) => item.id !== "");
}

// New UI: DataTables-style response — data key holds array of form objects
function parseNewUiEntityForms(parsed: unknown): ParsedItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;

  // Try preferred keys, then first array found
  let arr: unknown[] = [];
  for (const key of ["data", "forms", "items", "list"]) {
    if (Array.isArray(obj[key])) { arr = obj[key] as unknown[]; break; }
  }
  if (!arr.length && Array.isArray(parsed)) arr = parsed;
  if (!arr.length) {
    const first = Object.values(obj).find(v => Array.isArray(v));
    if (first) arr = first as unknown[];
  }

  return arr
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      const id = String(f.id ?? "").trim();
      const name = String(f.name ?? f.description ?? f.label ?? f.form_name ?? "").trim();
      return { id, name, raw };
    })
    .filter((item) => item.id !== "");
}


function parseOldUiItems(entityType: string, parsed: unknown): ParsedItem[] {
  if (entityType === "lookup_type") return parseLookupTypes(parsed);
  // All form types use formsByClusterId — entityType param filters server-side, no post-fetch filter needed
  return parseOldUiFormsResponse(parsed);
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchJson(url: string, cookie: string): Promise<{ parsed: unknown; error: string | null }> {
  let body: string;
  let status: number;
  try {
    const res = await fetch(url, { method: "GET", headers: { ...REQUEST_HEADERS, Cookie: cookie } });
    status = res.status;
    body = await res.text();
  } catch (err) {
    return { parsed: null, error: `Network error: ${String(err).slice(0, 200)}` };
  }
  if (status < 200 || status >= 300) {
    return { parsed: null, error: `HTTP ${status}` };
  }
  try {
    return { parsed: JSON.parse(body), error: null };
  } catch {
    return { parsed: null, error: "non-JSON response" };
  }
}

function isLoginRedirect(parsed: unknown): boolean {
  return !!(
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).state === "login"
  );
}

// ── Cluster helpers ───────────────────────────────────────────────────────────

async function fetchClusters(baseUrl: string, cookie: string): Promise<{ ids: string[]; nameMap: Record<string, string> }> {
  const { parsed, error } = await fetchJson(`${baseUrl}/app/iotool/clusters?showAll=true`, cookie);
  if (error || !parsed) {
    console.log("[xtract/extract] Clusters endpoint failed, falling back to clusterId=0 only");
    return { ids: ["0"], nameMap: {} };
  }

  let arr: unknown[] = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const found = obj.clusters ?? obj.data ?? obj.items ?? obj.list;
    if (Array.isArray(found)) arr = found as unknown[];
  }

  if (arr.length === 0) {
    console.log("[xtract/extract] Clusters endpoint returned no clusters, using clusterId=0 only");
    return { ids: ["0"], nameMap: {} };
  }

  const ids = new Set<string>();
  const nameMap: Record<string, string> = {};
  for (const c of arr) {
    if (c && typeof c === "object") {
      const cluster = c as Record<string, unknown>;
      const id = String(cluster.id ?? "").trim();
      const name = String(cluster.name ?? cluster.label ?? id).trim();
      if (id) { ids.add(id); nameMap[id] = name; }
    }
  }

  if (ids.size === 0) {
    console.log("[xtract/extract] No cluster IDs extracted from response, falling back to clusterId=0");
    return { ids: ["0"], nameMap: {} };
  }

  console.log(`[xtract/extract] Found ${ids.size} cluster IDs: ${Array.from(ids).join(", ")}`);
  return { ids: Array.from(ids), nameMap };
}

async function fetchFormsByAllClusters(
  baseUrl: string,
  cookie: string,
  entityType: string,
  clusterIds: string[],
): Promise<{ items: ParsedItem[]; sessionExpired: boolean }> {
  const seen = new Set<string>();
  const merged: ParsedItem[] = [];

  for (const clusterId of clusterIds) {
    const url = `${baseUrl}/app/iotool/form/formsByClusterId?clusterId=${encodeURIComponent(clusterId)}&showAll=false&entityType=${encodeURIComponent(entityType)}`;
    const { parsed, error } = await fetchJson(url, cookie);
    if (error || !parsed) continue;
    if (isLoginRedirect(parsed)) return { items: [], sessionExpired: true };

    const items = parseOldUiItems(entityType, parsed);
    let newCount = 0;
    for (const item of items) {
      if (item.id && !seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
        newCount++;
      }
    }
    console.log(`[xtract/extract] cluster ${clusterId} → ${items.length} records (${newCount} new after dedup)`);
  }

  // ── Post-merge content_type_id filter ─────────────────────────────────────
  // clusterId=0 leaks mixed types; specific cluster calls can still include
  // forms from other entity types. Filter to the expected content_type_id.
  const CONTENT_TYPE_FILTER: Record<string, string> = {
    task:   "1",
    order:  "2",
    client: "3",
    flight: "4",  // best guess — logged below if wrong
  };

  if (entityType in CONTENT_TYPE_FILTER) {
    const expected = CONTENT_TYPE_FILTER[entityType];
    const beforeCount = merged.length;

    const filtered = merged.filter(item => {
      const ct = (item.raw as Record<string, unknown>).content_type_id;
      return String(ct) === expected;
    });

    console.log(`[xtract/extract] content_type_id filter (${entityType}, expected=${expected ?? "none"}): ${beforeCount} → ${filtered.length}`);
    return { items: filtered, sessionExpired: false };
  }

  return { items: merged, sessionExpired: false };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { instanceId: string; extractionType: string };
    const { instanceId, extractionType } = body;

    if (!instanceId || !extractionType) {
      return NextResponse.json({ error: "Missing required fields: instanceId, extractionType" }, { status: 400 });
    }

    const entityType = UI_TYPE_TO_ENTITY[extractionType];
    if (!entityType) {
      return NextResponse.json(
        { error: `Unknown extractionType: "${extractionType}". Valid: ${Object.keys(UI_TYPE_TO_ENTITY).join(", ")}` },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: `Instance "${instance.name}" has no session cookie. Refresh it on the Instances page.` },
        { status: 400 }
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

    let items: ParsedItem[] = [];

    // ── Try New UI first for the four form types ───────────────────────────────
    const newUiPath = NEW_UI_ENDPOINTS[extractionType];
    if (newUiPath) {
      const { parsed, error } = await fetchJson(`${baseUrl}${newUiPath}`, cookie);
      if (parsed && isLoginRedirect(parsed)) {
        return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
      }
      if (!error && parsed !== null) {
        items = parseNewUiEntityForms(parsed);
        console.log(`[xtract/extract] New UI returned ${items.length} items for ${extractionType}`);
      }
    }

    // ── Fall back to Old UI if New UI returned nothing ─────────────────────────
    if (items.length === 0) {
      if (entityType === "lookup_type") {
        // Lookups: single global endpoint, no cluster scoping
        const { parsed, error } = await fetchJson(`${baseUrl}${OLD_UI_LOOKUP_ENDPOINT}`, cookie);
        if (error && !parsed) {
          return NextResponse.json({ error: `TapClicks API error: ${error}` }, { status: 502 });
        }
        if (parsed && isLoginRedirect(parsed)) {
          return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
        }
        if (parsed) {
          items = parseOldUiItems(entityType, parsed);
          console.log(`[xtract/extract] Old UI returned ${items.length} lookup types`);
        }
      } else if (entityType === "line_item") {
        // Product Forms: global call + per-cluster calls, merged and deduped by id
        const { ids: clusterIds, nameMap: clusterNames } = await fetchClusters(baseUrl, cookie);
        const specificClusters = clusterIds.filter(id => id !== "0");

        // Global call first (no clusterId), then one per specific cluster
        const productUrls = [
          `${baseUrl}/app/iotool/products?showAll=yes`,
          ...specificClusters.map(id => `${baseUrl}/app/iotool/products?clusterId=${encodeURIComponent(id)}&showAll=yes`),
        ];

        const seen = new Set<string>();
        for (const url of productUrls) {
          const { parsed, error } = await fetchJson(url, cookie);
          if (error || !parsed) continue;
          if (isLoginRedirect(parsed)) {
            return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
          }
          const obj = parsed as Record<string, unknown>;
          const rawArr: unknown[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray(obj.products) ? (obj.products as unknown[]) : [];
          for (const raw of rawArr) {
            const p = raw as Record<string, unknown>;
            const id = String(p.id ?? p.product_id ?? "").trim();
            if (id && !seen.has(id)) {
              seen.add(id);
              items.push({ id, name: String(p.name ?? p.product_name ?? "").trim(), raw });
            }
          }
        }

        // Enrich each product with bu_names and is_active
        items = items.map(item => {
          const p = item.raw as Record<string, unknown>;

          // Resolve cluster_ids to BU names
          const allClusters = p.all_clusters;
          const rawCids = p.cluster_ids;
          let cidArr: string[] = [];
          if (Array.isArray(rawCids)) cidArr = rawCids.map(String);
          else if (typeof rawCids === "string" && rawCids) cidArr = rawCids.split(",").map(s => s.trim());
          else if (rawCids !== null && rawCids !== undefined) cidArr = [String(rawCids)];

          let bu_names: string[];
          if (allClusters === "1" || allClusters === 1 || allClusters === true || cidArr.includes("0")) {
            bu_names = ["All Business Units"];
          } else {
            bu_names = cidArr.length > 0 ? cidArr.map(cid => clusterNames[cid] ?? cid) : ["All Business Units"];
          }

          const active = p.active;
          const is_active = active === "1" || active === 1 || active === true;

          return { ...item, bu_names, is_active };
        });

        console.log(`[xtract/extract] products cluster-merge: ${items.length} product forms`);
      } else {
        // Client/order/task/flight forms: fetch across every cluster and merge
        const { ids: clusterIds } = await fetchClusters(baseUrl, cookie);
        console.log(`[xtract/extract] Fetching ${extractionType} (entityType=${entityType}) across ${clusterIds.length} cluster(s)`);

        const { items: merged, sessionExpired } = await fetchFormsByAllClusters(baseUrl, cookie, entityType, clusterIds);
        if (sessionExpired) {
          return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
        }

        items = merged;
        console.log(`[xtract/extract] Old UI cluster-merge: ${items.length} total records for ${extractionType}`);
      }
    }

    // ── Save to extractions ────────────────────────────────────────────────────
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

    return NextResponse.json({
      id:            inserted.id,
      created_at:    inserted.created_at,
      entity_type:   extractionType,
      record_count:  items.length,
      instance_name: instance.name,
    });
  } catch (err) {
    console.error("[xtract/extract] Unhandled:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
