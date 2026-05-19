import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdfloTaskForm {
  id: string;
  name: string;
  parent_form_id: string | null;
  parent_form_name: string | null;
}

interface AdfloProduct {
  id: string;
  name: string;
}

interface ClassicWorkflow {
  id: string;
  name: string;
}

interface ClassicTaskEntry {
  taskFormName: string;
  referenceTable: string;
  workflowName: string;
  productName: string;
}

export interface ConflictOption {
  classicProductName: string;
  adfloId: string | null;
  adfloName: string | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface AnalysisProposal {
  taskFormId: string;
  taskFormName: string;
  currentParentId?: string | null;
  currentParentName?: string | null;
  proposedParentId: string | null;
  proposedParentName: string | null;
  parentEntityType: string | null;
  confidence: "high" | "medium" | "low" | null;
  reasoning: string;
  status: "proposed" | "conflict" | "not_found";
  conflictDetails?: string;
  conflictOptions?: ConflictOption[];
  classicWorkflows?: string[];
}

// ─── Request helpers ──────────────────────────────────────────────────────────

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getJSON(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { ...headers, Accept: "application/json" } });
    if (!res.ok) { console.warn(`[analyze] GET ${url} → HTTP ${res.status}`); return null; }
    return await res.json();
  } catch (e) {
    console.warn(`[analyze] GET ${url} failed:`, e);
    return null;
  }
}

async function getText(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) { console.warn(`[analyze] GET (text) ${url} → HTTP ${res.status}`); return null; }
    return await res.text();
  } catch (e) {
    console.warn(`[analyze] GET (text) ${url} failed:`, e);
    return null;
  }
}

function isExpired(parsed: unknown): boolean {
  return !!(parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login");
}

function toArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    for (const k of ["data", "items", "results", "forms", "workflows", "task", "line_item"]) {
      if (Array.isArray(p[k])) return p[k] as unknown[];
    }
  }
  return [];
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────
//
// TapClicks workflow export CSVs contain a tasks section with task_form_name
// and reference_table columns. The format has a top-level section (workflow /
// product metadata) followed by one or more entity-type subsections.
// We log the first lines of each CSV so the exact format can be verified.

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQ)       { inQ = true; continue; }
    if (ch === '"' && inQ)        { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; continue; }
    if (ch === ',' && !inQ)       { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseWorkflowCsv(csvText: string, workflowName: string): {
  productName: string;
  tasks: ClassicTaskEntry[];
} {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  console.log(`[analyze] CSV "${workflowName}" — first 8 lines:`, lines.slice(0, 8));

  let productName = "";
  let taskHeaderRow = -1;
  let taskHeaders: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const lower = cells.map(c => c.toLowerCase());

    // Capture product_name value if this is a header row followed by a data row
    const prodIdx = lower.findIndex(c => c === "product_name" || c === "productname");
    if (prodIdx >= 0 && i + 1 < lines.length) {
      const next = parseCsvRow(lines[i + 1]);
      if (next[prodIdx] && !next[prodIdx].toLowerCase().includes("product")) {
        productName = next[prodIdx];
      }
    }

    // Find the row that starts the tasks sub-section
    if (lower.some(c => c === "task_form_name" || c === "taskformname" || c === "task form name")) {
      taskHeaderRow = i;
      taskHeaders = lower;
      break;
    }
  }

  if (taskHeaderRow === -1) {
    console.log(`[analyze] No task section found in CSV for "${workflowName}"`);
    return { productName, tasks: [] };
  }

  const tfIdx  = taskHeaders.findIndex(c => c === "task_form_name" || c === "taskformname" || c === "task form name");
  const refIdx = taskHeaders.findIndex(c => c === "reference_table" || c === "referencetable" || c === "reference table" || c === "entity_type");

  const tasks: ClassicTaskEntry[] = [];
  for (let i = taskHeaderRow + 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const name = cells[tfIdx]?.trim();
    if (!name) continue;
    tasks.push({
      taskFormName: name,
      referenceTable: refIdx >= 0 ? (cells[refIdx]?.trim() || "line_item") : "line_item",
      workflowName,
      productName,
    });
  }

  console.log(`[analyze] CSV "${workflowName}" — product: "${productName}", tasks: ${tasks.length}`);
  return { productName, tasks };
}

// ─── Claude name matching ─────────────────────────────────────────────────────

interface NameMatch {
  classicName: string;
  adfloId: string;
  adfloName: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

async function matchNamesWithClaude(
  classicNames: string[],
  adfloProducts: AdfloProduct[]
): Promise<Map<string, { adfloId: string; adfloName: string; confidence: "high" | "medium" | "low" }>> {
  const map = new Map<string, { adfloId: string; adfloName: string; confidence: "high" | "medium" | "low" }>();

  if (!classicNames.length || !adfloProducts.length) return map;

  // First pass: exact (case-insensitive) matches without calling Claude
  const remaining: string[] = [];
  for (const cn of classicNames) {
    const exact = adfloProducts.find(p => p.name.toLowerCase() === cn.toLowerCase());
    if (exact) {
      map.set(cn, { adfloId: exact.id, adfloName: exact.name, confidence: "high" });
    } else {
      remaining.push(cn);
    }
  }

  if (!remaining.length) return map;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[analyze] ANTHROPIC_API_KEY not set — skipping AI name matching");
    return map;
  }

  const prompt = `You are matching product/line-item names between two ad-operations systems: Classic TapClicks and Adflo OMS.

Classic product names that need matching (exact matches already removed):
${remaining.map((n, i) => `${i + 1}. "${n}"`).join("\n")}

Available Adflo products:
${adfloProducts.map(p => `  id="${p.id}" name="${p.name}"`).join("\n")}

For each Classic name find the best Adflo product match. Consider abbreviations, underscores-as-spaces, acronyms, and semantic similarity (e.g. "O&O" → "Owned & Operated", "adv_email" → "Advantage Email").

Respond ONLY with a JSON array — no prose, no markdown fences:
[{"classicName":"...","adfloId":"...","adfloName":"...","confidence":"high"|"medium"|"low","reasoning":"..."}]

Omit entries where no reasonable match exists. Use "high" for clear matches, "medium" for likely matches, "low" for uncertain guesses.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[analyze] Claude API error: HTTP ${res.status}`, await res.text());
      return map;
    }

    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";
    const jsonStart = text.indexOf("[");
    const jsonEnd   = text.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1) {
      console.error("[analyze] Claude returned no JSON array:", text.slice(0, 200));
      return map;
    }

    const matches: NameMatch[] = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    for (const m of matches) {
      if (m.classicName && m.adfloId) {
        map.set(m.classicName, { adfloId: m.adfloId, adfloName: m.adfloName, confidence: m.confidence ?? "medium" });
      }
    }
    console.log(`[analyze] Claude matched ${map.size - (classicNames.length - remaining.length)} of ${remaining.length} fuzzy names`);
  } catch (e) {
    console.error("[analyze] Claude call threw:", e);
  }

  return map;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { instanceId, unassignedOnly = true } = (await req.json()) as { instanceId: string; unassignedOnly?: boolean };
  if (!instanceId) return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });

  // Auth
  const { data: instance, error: instanceErr } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, session_cookie")
    .eq("id", instanceId)
    .single();

  if (instanceErr || !instance) return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  if (!instance.session_cookie) return NextResponse.json({ error: "No session cookie stored" }, { status: 400 });

  let cookie: string;
  try { cookie = decryptText(instance.session_cookie); }
  catch { return NextResponse.json({ error: "Failed to decrypt cookie" }, { status: 500 }); }

  const base = (instance.base_url.startsWith("http") ? instance.base_url : "https://" + instance.base_url).replace(/\/+$/, "");
  const hdrs = { Cookie: cookie, "X-Requested-With": "XMLHttpRequest", "User-Agent": UA };

  // ── 1. Adflo task forms (unassigned) ──────────────────────────────────────

  console.log("[analyze] Fetching Adflo task forms…");
  const taskRaw = await getJSON(`${base}/server/api/entityforms/task?all=true`, hdrs);
  if (isExpired(taskRaw)) return NextResponse.json({ error: "Session expired. Refresh the cookie." }, { status: 401 });

  const allTaskForms: AdfloTaskForm[] = toArray(taskRaw).map((r) => {
    const x = r as Record<string, unknown>;
    // parent_form_id may be a plain string/number or an object { id, name, ... }.
    // Normalise to a string ID (or null) so the unassigned filter is unambiguous.
    const rawParent = x.parent_form_id;
    let parentId: string | null = null;
    if (rawParent != null && rawParent !== "" && rawParent !== 0 && rawParent !== "0") {
      if (typeof rawParent === "object") {
        const objId = (rawParent as Record<string, unknown>).id;
        if (objId != null && objId !== "" && objId !== 0 && objId !== "0") {
          parentId = String(objId).trim() || null;
        }
      } else {
        parentId = String(rawParent).trim() || null;
      }
    }
    // parent_form_name may likewise be an object { id, name, entity_type, ... } or a plain string.
    const rawParentName = x.parent_form_name;
    let parentFormName: string | null = null;
    if (rawParentName) {
      if (typeof rawParentName === "object") {
        parentFormName = String((rawParentName as Record<string, unknown>).name ?? "").trim() || null;
      } else {
        parentFormName = String(rawParentName).trim() || null;
      }
    }
    return {
      id:               String(x.id ?? "").trim(),
      name:             String(x.name ?? x.label ?? "").trim(),
      parent_form_id:   parentId,
      parent_form_name: parentFormName,
    };
  }).filter(f => f.id);

  // Unassigned = parent_form_id is null (covers null, "", 0, "0" after normalisation above).
  const unassigned = allTaskForms.filter(f => f.parent_form_id === null);
  console.log(`[analyze] Task forms: ${allTaskForms.length} total, ${unassigned.length} unassigned (${allTaskForms.length - unassigned.length} already have a parent)`);

  const formsToAnalyze = unassignedOnly ? unassigned : allTaskForms;
  console.log(`[analyze] Mode: ${unassignedOnly ? "unassigned-only" : "all"} — analyzing ${formsToAnalyze.length} forms`);

  // ── 2. Adflo parent-form candidates (one fetch per entity type) ──────────
  //
  // Task forms can belong to any of four parent entity types. Fetch all four
  // so name matching uses the correct pool for each reference_table value.

  const PARENT_ENTITY_TYPES = ["line_item", "flight", "order", "client"] as const;

  console.log("[analyze] Fetching Adflo parent forms (line_item, flight, order, client)…");
  const parentFormResults = await Promise.all(
    PARENT_ENTITY_TYPES.map(async (et) => {
      const raw = await getJSON(`${base}/server/api/entityforms/${et}?all=true`, hdrs);
      if (isExpired(raw)) return { et, forms: null };
      const forms: AdfloProduct[] = toArray(raw).map((r) => {
        const x = r as Record<string, unknown>;
        return { id: String(x.id ?? "").trim(), name: String(x.name ?? x.label ?? "").trim() };
      }).filter(p => p.id);
      console.log(`[analyze] Adflo ${et} forms: ${forms.length}`);
      return { et, forms };
    })
  );

  if (parentFormResults.some(r => r.forms === null)) {
    return NextResponse.json({ error: "Session expired. Refresh the cookie." }, { status: 401 });
  }

  const adfloFormsByType: Record<string, AdfloProduct[]> = {};
  for (const { et, forms } of parentFormResults) {
    adfloFormsByType[et] = forms!;
  }

  // ── 3. Classic workflow list ───────────────────────────────────────────────

  console.log("[analyze] Fetching Classic workflows…");
  const wfRaw = await getJSON(`${base}/app/iotool/workflows?showAll=true`, hdrs);
  if (isExpired(wfRaw)) return NextResponse.json({ error: "Session expired. Refresh the cookie." }, { status: 401 });

  const classicWorkflows: ClassicWorkflow[] = [];
  const wfArr = Array.isArray((wfRaw as Record<string, unknown>)?.workflows)
    ? (wfRaw as Record<string, unknown>).workflows as unknown[]
    : toArray(wfRaw);
  for (const r of wfArr) {
    const x = r as Record<string, unknown>;
    const id = String(x.id ?? x.workflow_id ?? "").trim();
    const name = String(x.name ?? x.title ?? "").trim();
    if (id) classicWorkflows.push({ id, name });
  }
  console.log(`[analyze] Classic workflows: ${classicWorkflows.length}`);

  // ── 4. Fetch all workflow CSVs in parallel ─────────────────────────────────

  console.log("[analyze] Fetching workflow CSV exports…");
  const csvResults = await Promise.all(
    classicWorkflows.map(async (wf) => {
      const csv = await getText(`${base}/app/iotool/workflows/export?id=${wf.id}`, hdrs);
      if (!csv) return { wf, productName: "", tasks: [] as ClassicTaskEntry[] };
      const { productName, tasks } = parseWorkflowCsv(csv, wf.name);
      return { wf, productName, tasks };
    })
  );

  // Build taskFormName → entries map
  const classicTaskMap = new Map<string, ClassicTaskEntry[]>();
  for (const { tasks } of csvResults) {
    for (const entry of tasks) {
      const existing = classicTaskMap.get(entry.taskFormName) ?? [];
      existing.push(entry);
      classicTaskMap.set(entry.taskFormName, existing);
    }
  }
  console.log(`[analyze] Classic task map: ${classicTaskMap.size} unique form names across all workflows`);

  // ── 5. Claude name matching (per entity type) ─────────────────────────────
  //
  // Group Classic product names by their reference_table so each group is
  // matched against the correct Adflo parent-form pool.

  const neededByType = new Map<string, Set<string>>();
  for (const tf of formsToAnalyze) {
    for (const e of classicTaskMap.get(tf.name) ?? []) {
      if (!e.productName) continue;
      const et = e.referenceTable || "line_item";
      if (!neededByType.has(et)) neededByType.set(et, new Set());
      neededByType.get(et)!.add(e.productName);
    }
  }

  console.log("[analyze] Name matching by entity type:", [...neededByType.entries()].map(([k, v]) => `${k}:${v.size}`).join(", "));

  // Run matching in parallel, one call per entity type that has candidates
  const perTypeResults = await Promise.all(
    [...neededByType.entries()].map(async ([et, names]) => {
      const pool = adfloFormsByType[et] ?? [];
      if (!pool.length) {
        console.warn(`[analyze] No Adflo ${et} forms to match against — skipping`);
        return { et, map: new Map<string, { adfloId: string; adfloName: string; confidence: "high" | "medium" | "low" }>() };
      }
      const map = await matchNamesWithClaude([...names], pool);
      return { et, map };
    })
  );

  // Flatten into a single nameMapping. Keys are Classic product names, which
  // are scoped to one entity type per task form entry, so collisions are safe.
  const nameMapping = new Map<string, { adfloId: string; adfloName: string; confidence: "high" | "medium" | "low" }>();
  for (const { map } of perTypeResults) {
    for (const [k, v] of map) nameMapping.set(k, v);
  }

  // ── 6. Build proposals ────────────────────────────────────────────────────

  const proposals: AnalysisProposal[] = [];

  for (const tf of formsToAnalyze) {
    const entries = classicTaskMap.get(tf.name) ?? [];

    const currentParentId   = tf.parent_form_id;
    const currentParentName = tf.parent_form_name;

    if (entries.length === 0) {
      proposals.push({
        taskFormId: tf.id, taskFormName: tf.name,
        currentParentId, currentParentName,
        proposedParentId: null, proposedParentName: null, parentEntityType: null,
        confidence: null, reasoning: "Not found in any Classic workflow",
        status: "not_found",
      });
      continue;
    }

    // Multiple distinct products → conflict
    const uniqueProducts = [...new Set(entries.map(e => e.productName))];
    if (uniqueProducts.length > 1) {
      const refTable = entries[0].referenceTable || "line_item";
      const conflictOptions: ConflictOption[] = uniqueProducts.map(classicProductName => {
        const match = nameMapping.get(classicProductName);
        return {
          classicProductName,
          adfloId:    match?.adfloId    ?? null,
          adfloName:  match?.adfloName  ?? null,
          confidence: match?.confidence ?? null,
        };
      });
      proposals.push({
        taskFormId: tf.id, taskFormName: tf.name,
        currentParentId, currentParentName,
        proposedParentId: null, proposedParentName: null,
        parentEntityType: refTable,
        confidence: null,
        reasoning: "Found in multiple Classic workflows with different products — select one to proceed",
        status: "conflict",
        conflictDetails: entries.map(e => `${e.workflowName} → ${e.productName}`).join(" | "),
        conflictOptions,
        classicWorkflows: entries.map(e => e.workflowName),
      });
      continue;
    }

    const classicProduct = entries[0].productName;
    const refTable       = entries[0].referenceTable || "line_item";
    const match          = nameMapping.get(classicProduct);

    if (match) {
      proposals.push({
        taskFormId: tf.id, taskFormName: tf.name,
        currentParentId, currentParentName,
        proposedParentId: match.adfloId, proposedParentName: match.adfloName,
        parentEntityType: refTable,
        confidence: match.confidence,
        reasoning: `Classic: "${classicProduct}" in "${entries[0].workflowName}" → Adflo: "${match.adfloName}"`,
        status: "proposed",
        classicWorkflows: [...new Set(entries.map(e => e.workflowName))],
      });
    } else {
      // Not matched — still propose with null parent so user can fill in
      proposals.push({
        taskFormId: tf.id, taskFormName: tf.name,
        currentParentId, currentParentName,
        proposedParentId: null, proposedParentName: classicProduct,
        parentEntityType: refTable,
        confidence: "low",
        reasoning: `Found in Classic under "${classicProduct}" but no Adflo product match found — manual assignment needed`,
        status: "proposed",
        classicWorkflows: [...new Set(entries.map(e => e.workflowName))],
      });
    }
  }

  const summary = {
    totalAnalyzed: formsToAnalyze.length,
    proposed:  proposals.filter(p => p.status === "proposed").length,
    conflicts: proposals.filter(p => p.status === "conflict").length,
    notFound:  proposals.filter(p => p.status === "not_found").length,
  };
  console.log("[analyze] Complete:", summary);

  return NextResponse.json({
    summary,
    proposals,
    nameMapping: [...nameMapping.entries()].map(([classicName, m]) => ({ classicName, ...m })),
  });
}
