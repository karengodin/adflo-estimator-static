"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Instance = {
  id: string;
  name: string;
  base_url: string;
  session_cookie: string | null;
};

type ExtractionItem = {
  item_id: string;
  item_name: string;
  reference_table: string | null;
  entity_type: string;
  created_at: string;
};

type MigrationRun = {
  entity_type: string;
  item_id: string;
  item_name?: string;
  status: string;
  http_code?: number;
  snippet: string;
  run_at: string;
  is_retry?: boolean;
};

type MigrateResult = {
  id: string;
  name: string;
  status: string;
  httpCode: number;
  snippet: string;
  requestUrl: string;
  ranAt: string;
  isRetry: boolean;
};

type QueueItem = {
  taskFormId: string;
  taskFormName: string;
  currentWorkflow: string;
  targetWorkflowId: string;
  targetWorkflowName: string;
  status: "pending" | "running" | "done" | "failed";
  resultSnippet?: string;
};

type ClassicItem = { id: string; name: string };
type MigratePayloadItem = { id: string; name: string; referenceTable: string | null };

type ConflictOption = {
  classicProductName: string;
  adfloId: string | null;
  adfloName: string | null;
  confidence: string | null;
};

type AnalysisProposal = {
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
};

type AnalysisSummary = {
  totalAnalyzed: number;
  proposed: number;
  conflicts: number;
  notFound: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { key: "lookup_type", label: "Lookup Types" },
  { key: "client",      label: "Client Forms" },
  { key: "order",       label: "Order Forms" },
  { key: "line_item",   label: "Product Forms" },
  { key: "flight",      label: "Flight Forms" },
  { key: "task",        label: "Task Forms" },
] as const;

const ENTITY_TYPE_LABELS: Record<string, string> = {
  lookup_type:       "Lookup Type",
  client:            "Client Form",
  order:             "Order Form",
  line_item:         "Product Form",
  flight:            "Flight Form",
  task:              "Task Form",
  workflow:          "Workflow",
  task_form_parent:  "Task Form Parent",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function migrateResultsToCsvRows(
  results: MigrateResult[],
  entityType: string,
): Record<string, unknown>[] {
  const STATUS_LABEL: Record<string, string> = {
    success:              "succeeded",
    partial_success:      "partial",
    error:                "failed",
    skipped:              "skipped",
    needs_parent_selection: "needs parent",
  };
  return results.map((r) => {
    const info = humanStatus(r.status, r.snippet);
    return {
      entity_type:  ENTITY_TYPE_LABELS[entityType] ?? entityType,
      item_name:    r.name,
      item_id:      r.id,
      status:       STATUS_LABEL[r.status] ?? r.status,
      description:  info.description,
      http_code:    r.httpCode || "",
      snippet:      r.snippet,
      timestamp:    r.ranAt,
      is_retry:     r.isRetry ? "yes" : "no",
    };
  });
}

function migrationRunsToCsvRows(runs: MigrationRun[]): Record<string, unknown>[] {
  const STATUS_LABEL: Record<string, string> = {
    success:              "succeeded",
    partial_success:      "partial",
    error:                "failed",
    skipped:              "skipped",
    needs_parent_selection: "needs parent",
  };
  return runs.map((r) => {
    const info = humanStatus(r.status, r.snippet);
    return {
      entity_type:  ENTITY_TYPE_LABELS[r.entity_type] ?? r.entity_type,
      item_name:    r.item_name ?? "",
      item_id:      r.item_id,
      status:       STATUS_LABEL[r.status] ?? r.status,
      description:  info.description,
      http_code:    r.http_code ?? "",
      snippet:      r.snippet,
      timestamp:    r.run_at,
      is_retry:     r.is_retry ? "yes" : "no",
    };
  });
}

function humanStatus(status: string, snippet: string) {
  const isNoOp = snippet.includes("NO-OP") || snippet.toLowerCase().includes("0 items added");
  switch (status) {
    case "success": {
      const m = snippet.match(/added (\d+) items?/i);
      return { label: "Succeeded", description: m ? `Succeeded — ${m[1]} item${m[1] === "1" ? "" : "s"} added` : "Succeeded", color: "#16a34a", bg: "rgba(34,197,94,0.12)" };
    }
    case "partial_success":
      return { label: "Partial", description: "Partial — unsupported field types (acceptable)", color: "#b45309", bg: "rgba(251,191,36,0.12)" };
    case "error":
      if (isNoOp) return { label: "Dep. failure", description: "Dependency failure — will retry automatically", color: "#7c3aed", bg: "rgba(124,58,237,0.10)" };
      return { label: "Failed", description: `Failed — ${snippet.replace(/^ERRORS?:\s*/i, "").slice(0, 120)}`, color: "#dc2626", bg: "rgba(239,68,68,0.12)" };
    case "skipped":
      return { label: "Skipped", description: "Skipped — already succeeded", color: "#64748b", bg: "rgba(148,163,184,0.12)" };
    case "needs_parent_selection":
      return { label: "Needs parent", description: `Needs parent selection — ${snippet}`, color: "#2f6fed", bg: "rgba(47,111,237,0.10)" };
    default:
      return { label: status, description: snippet, color: "#64748b", bg: "rgba(148,163,184,0.12)" };
  }
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function resolveInput(raw: string, items: ExtractionItem[]) {
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  const resolved: ExtractionItem[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const match = items.find((i) => i.item_id === token) ?? items.find((i) => i.item_name.toLowerCase() === token.toLowerCase());
    if (match) resolved.push(match);
    else unmatched.push(token);
  }
  return { resolved, unmatched };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [activeTab, setActiveTab] = useState<"classic" | "reassignment">("classic");

  const [extractions, setExtractions] = useState<Record<string, ExtractionItem[]>>({});
  const [extractionsLoading, setExtractionsLoading] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);

  const exportHistory = async () => {
    if (!selectedInstanceId) return;
    setExportingHistory(true);
    try {
      const res = await fetch(`/api/migration-runs?instanceId=${selectedInstanceId}`);
      const data = await res.json();
      if (!res.ok) {
        alert(`Export failed: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const runs: MigrationRun[] = Array.isArray(data) ? data : [];
      if (!runs.length) { alert("No migration runs found for this instance."); return; }
      const instanceName = instances.find((i) => i.id === selectedInstanceId)?.name ?? selectedInstanceId;
      const slug = instanceName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      downloadCsv(migrationRunsToCsvRows(runs), `migration-history-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally {
      setExportingHistory(false);
    }
  };
  // Latest run per (entityType, itemId) — for checklist badges
  const [latestRun, setLatestRun] = useState<Record<string, Record<string, MigrationRun>>>({});
  // All runs per (entityType, itemId) — for expandable history
  const [allRuns, setAllRuns] = useState<Record<string, Record<string, MigrationRun[]>>>({});

  useEffect(() => {
    fetch("/api/tapclicks-instances")
      .then((r) => r.json())
      .then((data) => { setInstances(Array.isArray(data) ? data : []); setInstancesLoading(false); })
      .catch(() => setInstancesLoading(false));
  }, []);

  const loadData = useCallback(async (instanceId: string, showSpinner = true) => {
    if (!instanceId) return;
    if (showSpinner) setExtractionsLoading(true);

    const [extractionRes, runsRes] = await Promise.all([
      fetch(`/api/extractions?instanceId=${instanceId}`).then((r) => r.json()),
      fetch(`/api/migration-runs?instanceId=${instanceId}`).then((r) => r.json()),
    ]);

    const rows: ExtractionItem[] = Array.isArray(extractionRes) ? extractionRes : [];
    const byType: Record<string, ExtractionItem[]> = {};
    for (const row of rows) {
      if (!byType[row.entity_type]) byType[row.entity_type] = [];
      byType[row.entity_type].push(row);
    }
    setExtractions(byType);

    const runs: MigrationRun[] = Array.isArray(runsRes) ? runsRes : [];
    // runs are ordered DESC by run_at from the API
    const allMap: Record<string, Record<string, MigrationRun[]>> = {};
    const latestMap: Record<string, Record<string, MigrationRun>> = {};
    for (const run of runs) {
      if (!allMap[run.entity_type]) allMap[run.entity_type] = {};
      if (!allMap[run.entity_type][run.item_id]) allMap[run.entity_type][run.item_id] = [];
      allMap[run.entity_type][run.item_id].push(run);
      if (!latestMap[run.entity_type]) latestMap[run.entity_type] = {};
      if (!latestMap[run.entity_type][run.item_id]) latestMap[run.entity_type][run.item_id] = run;
    }
    setAllRuns(allMap);
    setLatestRun(latestMap);
    setExtractionsLoading(false);
  }, []);

  useEffect(() => {
    if (selectedInstanceId) {
      setExtractions({});
      setLatestRun({});
      setAllRuns({});
      loadData(selectedInstanceId);
    }
  }, [selectedInstanceId, loadData]);

  return (
    <div style={{ margin: "0 auto", padding: "28px 24px" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f1623" }}>adfloMigrate</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#627286" }}>Classic → Adflo migration</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 280 }}>
          <label style={labelStyle}>Instance</label>
          {instancesLoading ? (
            <span style={{ fontSize: 13, color: "#8a9bb0", padding: "10px 0" }}>Loading…</span>
          ) : instances.length === 0 ? (
            <span style={{ fontSize: 13, color: "#dc2626" }}>No instances found. Add one on the Instances page.</span>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={selectedInstanceId} onChange={(e) => setSelectedInstanceId(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                <option value="">Select an instance…</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
              {selectedInstanceId && (
                <button
                  onClick={exportHistory}
                  disabled={exportingHistory}
                  title="Export full migration history for this instance as CSV"
                  style={{ ...ghostBtnStyle, fontSize: 12, whiteSpace: "nowrap", opacity: exportingHistory ? 0.6 : 1 }}
                >
                  {exportingHistory ? "Exporting…" : "Export History"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", borderBottom: "1px solid #dde5ef", marginBottom: 20 }}>
        {(["classic", "reassignment"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "9px 20px",
              border: "none",
              background: "transparent",
              fontWeight: 600,
              fontSize: 13.5,
              cursor: "pointer",
              color: activeTab === tab ? "#2f6fed" : "#627286",
              borderBottom: activeTab === tab ? "2px solid #2f6fed" : "2px solid transparent",
              marginBottom: -1,
              fontFamily: "inherit",
            }}
          >
            {tab === "classic" ? "Classic → Adflo" : "Adflo Reassignment"}
          </button>
        ))}
      </div>

      {!selectedInstanceId && (
        <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: "56px 32px", textAlign: "center", color: "#8a9bb0", fontSize: 14 }}>
          Select an instance above to begin.
        </div>
      )}

      {selectedInstanceId && extractionsLoading && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "#8a9bb0", fontSize: 14 }}>Loading…</div>
      )}

      {selectedInstanceId && !extractionsLoading && activeTab === "classic" && (
        <ClassicTab
          instanceId={selectedInstanceId}
          extractions={extractions}
          latestRun={latestRun}
          allRuns={allRuns}
          onRefresh={(silent) => loadData(selectedInstanceId, !silent)}
        />
      )}

      {selectedInstanceId && !extractionsLoading && activeTab === "reassignment" && (
        <ReassignmentTab
          instanceId={selectedInstanceId}
          extractions={extractions}
        />
      )}
    </div>
  );
}

// ─── Tab 1: Classic → Adflo ───────────────────────────────────────────────────

function ClassicTab({
  instanceId,
  extractions,
  latestRun,
  allRuns,
  onRefresh,
}: {
  instanceId: string;
  extractions: Record<string, ExtractionItem[]>;
  latestRun: Record<string, Record<string, MigrationRun>>;
  allRuns: Record<string, Record<string, MigrationRun[]>>;
  onRefresh: (silent: boolean) => void;
}) {
  return (
    <>
      {ENTITY_TYPES.map(({ key, label }) => (
        <EntitySection
          key={key}
          entityType={key}
          label={label}
          instanceId={instanceId}
          items={extractions[key] ?? []}
          latestRun={latestRun[key] ?? {}}
          allRuns={allRuns[key] ?? {}}
          onMigrated={() => onRefresh(true)}
        />
      ))}
    </>
  );
}

// ─── Entity Section ────────────────────────────────────────────────────────────

function EntitySection({
  entityType,
  label,
  instanceId,
  items,
  latestRun,
  allRuns,
  onMigrated,
}: {
  entityType: string;
  label: string;
  instanceId: string;
  items: ExtractionItem[];
  latestRun: Record<string, MigrationRun>;
  allRuns: Record<string, MigrationRun[]>;
  onMigrated: () => void;
}) {
  const [mode, setMode] = useState<"fetch" | "paste">("fetch");
  const [pasteInput, setPasteInput] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [migrating, setMigrating] = useState(false);
  const [results, setResults] = useState<MigrateResult[]>([]);
  const [filterQuery, setFilterQuery] = useState("");

  // Classic fetch state
  const [classicItems, setClassicItems] = useState<ClassicItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const pasteResolved = mode === "paste" && pasteInput.trim() ? resolveInput(pasteInput, items) : null;

  const displayedItems = entityType === "task" && filterQuery.trim()
    ? classicItems.filter((i) => i.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : classicItems;

  const toggleItem = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const selectAllPending = () =>
    setSelected(new Set(displayedItems.map((i) => i.id)));

  const fetchFromClassic = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/classic/${entityType}?instanceId=${instanceId}`);
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error ?? `HTTP ${res.status}`);
      } else {
        setClassicItems(Array.isArray(data) ? data : []);
        setSelected(new Set());
      }
    } catch (err) {
      setFetchError(`Network error: ${String(err).slice(0, 100)}`);
    } finally {
      setFetching(false);
    }
  };

  const getPayload = (): MigratePayloadItem[] => {
    if (mode === "paste") {
      return (pasteResolved?.resolved ?? []).map((i) => ({ id: i.item_id, name: i.item_name, referenceTable: i.reference_table }));
    }
    return classicItems.filter((i) => selected.has(i.id)).map((i) => ({ id: i.id, name: i.name, referenceTable: null }));
  };

  const runMigrate = async (payload: MigratePayloadItem[], appendResults = false) => {
    if (!payload.length) return;
    setMigrating(true);
    try {
      const res = await fetch("/api/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, entityType, items: payload, pendingOnly: false }),
      });
      const data = await res.json();
      const newResults: MigrateResult[] = data.results ?? [];
      setResults((prev) => appendResults ? [...prev, ...newResults] : newResults);
      onMigrated();
    } finally {
      setMigrating(false);
    }
  };

  const canMigrate = mode === "paste" ? (pasteResolved?.resolved.length ?? 0) > 0 : selected.size > 0;
  const migrateCount = mode === "paste" ? (pasteResolved?.resolved.length ?? 0) : selected.size;
  const successCount = items.filter((i) => latestRun[i.item_id]?.status === "success").length;
  const pendingCount = items.length - successCount;

  return (
    <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, marginBottom: 12, overflow: "hidden" }}>
      {/* Section header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #eef3f8", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#0f1623", flex: 1 }}>{label}</span>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {successCount > 0 && <Chip value={successCount} label="done" color="#16a34a" bg="rgba(34,197,94,0.1)" />}
          {pendingCount > 0 && items.length > 0 && <Chip value={pendingCount} label="pending" color="#627286" bg="rgba(148,163,184,0.1)" />}
        </div>

        {/* Mode toggle — always visible */}
        <div style={{ display: "flex", borderRadius: 8, border: "1px solid #dde5ef", overflow: "hidden" }}>
          {(["fetch", "paste"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "5px 12px", border: "none",
                background: mode === m ? "#2f6fed" : "transparent",
                color: mode === m ? "#fff" : "#627286",
                fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {m === "fetch" ? "Fetch from Classic" : "Paste IDs/Names"}
            </button>
          ))}
        </div>

        <button
          onClick={() => runMigrate(getPayload())}
          disabled={migrating || !canMigrate}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "6px 14px", opacity: migrating || !canMigrate ? 0.45 : 1 }}
        >
          {migrating ? "Migrating…" : canMigrate ? `Migrate (${migrateCount})` : "Migrate Selected"}
        </button>
      </div>

      {/* Paste mode */}
      {mode === "paste" && (
        <div style={{ padding: "14px 20px", borderBottom: results.length > 0 ? "1px solid #eef3f8" : "none" }}>
          <textarea
            style={{ ...inputStyle, minHeight: 72, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            placeholder="Paste comma-separated IDs or names…"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
          />
          {pasteResolved && (
            <div style={{ marginTop: 8, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {pasteResolved.resolved.length > 0 && (
                <span style={{ color: "#16a34a" }}>
                  ✓ {pasteResolved.resolved.length} resolved: {pasteResolved.resolved.map((i) => i.item_name || i.item_id).join(", ")}
                </span>
              )}
              {pasteResolved.unmatched.length > 0 && (
                <span style={{ color: "#dc2626" }}>Not found in extractions: {pasteResolved.unmatched.join(", ")}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fetch from Classic mode */}
      {mode === "fetch" && (
        <>
          {classicItems.length === 0 && (
            <div style={{ padding: "16px 20px", borderBottom: results.length > 0 ? "1px solid #eef3f8" : "none", display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={fetchFromClassic}
                disabled={fetching}
                style={{ ...primaryBtnStyle, opacity: fetching ? 0.6 : 1 }}
              >
                {fetching ? "Fetching…" : "Fetch from Classic"}
              </button>
              {fetchError && (
                <span style={{ fontSize: 13, color: "#dc2626" }}>{fetchError}</span>
              )}
            </div>
          )}

          {classicItems.length > 0 && (
            <>
              <div style={{ padding: "7px 20px", background: "#f8fafc", borderBottom: "1px solid #eef3f8", display: "flex", alignItems: "center", gap: 8 }}>
                {entityType === "task" && (
                  <input
                    type="text"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Search task forms…"
                    style={{
                      padding: "3px 8px", borderRadius: 6, border: "1px solid #dde5ef",
                      fontSize: 12, fontFamily: "inherit", outline: "none", color: "#0f1623", width: 180,
                    }}
                  />
                )}
                <button onClick={selectAllPending} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}>Select all</button>
                <button onClick={() => setSelected(new Set())} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}>Clear</button>
                <button
                  onClick={() => { setClassicItems([]); setSelected(new Set()); setFetchError(null); }}
                  style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}
                >
                  Re-fetch
                </button>
                <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
                  {classicItems.length} from Classic
                  {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                </span>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {displayedItems.length === 0 && filterQuery.trim() ? (
                  <div style={{ padding: "16px 20px", fontSize: 13, color: "#94a3b8" }}>
                    No task forms match &ldquo;{filterQuery}&rdquo;.
                  </div>
                ) : displayedItems.map((item, i) => {
                  const run = latestRun[item.id];
                  const isChecked = selected.has(item.id);
                  const statusInfo = run ? humanStatus(run.status, run.snippet) : null;
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItem(item.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 20px",
                        borderBottom: i < displayedItems.length - 1 ? "1px solid #f1f5f9" : "none",
                        background: isChecked ? "rgba(47,111,237,0.03)" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox" checked={isChecked}
                        onChange={() => toggleItem(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ accentColor: "#2f6fed", flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, fontSize: 13, color: "#0f1623", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name || item.id}
                      </span>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", flexShrink: 0 }}>
                        #{item.id}
                      </span>
                      {statusInfo && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: statusInfo.bg, color: statusInfo.color, flexShrink: 0 }}>
                          {statusInfo.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Results */}
      {results.length > 0 && (
        <ResultsPanel
          results={results}
          allRuns={allRuns}
          entityType={entityType}
          entityLabel={label}
          onRetry={(ids) => {
            const byId = new Map(classicItems.map((i) => [i.id, i]));
            const toRetry = ids
              .map((id) => byId.get(id) ?? items.find((i) => i.item_id === id))
              .filter(Boolean)
              .map((i) => "item_id" in i!
                ? { id: (i as ExtractionItem).item_id, name: (i as ExtractionItem).item_name, referenceTable: (i as ExtractionItem).reference_table }
                : { id: (i as ClassicItem).id, name: (i as ClassicItem).name, referenceTable: null }
              );
            runMigrate(toRetry, true);
          }}
          isRetrying={migrating}
        />
      )}
    </div>
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({
  results,
  allRuns,
  entityType,
  entityLabel,
  onRetry,
  isRetrying,
}: {
  results: MigrateResult[];
  allRuns: Record<string, MigrationRun[]>;
  entityType: string;
  entityLabel: string;
  onRetry: (ids: string[]) => void;
  isRetrying: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const latestById: Record<string, MigrateResult> = {};
  for (const r of results) latestById[r.id] = r;
  const latest = Object.values(latestById);

  const counts = {
    succeeded: latest.filter((r) => r.status === "success").length,
    partial:   latest.filter((r) => r.status === "partial_success").length,
    failed:    latest.filter((r) => r.status === "error").length,
    skipped:   latest.filter((r) => r.status === "skipped").length,
  };

  const isNoOp = (r: MigrateResult) => r.snippet.includes("NO-OP") || r.snippet.toLowerCase().includes("0 items added");
  const depFailures = latest.filter((r) => r.status === "error" && isNoOp(r));
  const realErrors  = latest.filter((r) => r.status === "error" && !isNoOp(r));

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div style={{ borderTop: "1px solid #eef3f8" }}>
      {/* Summary bar */}
      <div style={{ padding: "10px 20px", background: "#f8fafc", borderBottom: "1px solid #eef3f8", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>RUN RESULTS</span>
        {counts.succeeded > 0 && <Chip value={counts.succeeded} label="succeeded" color="#16a34a" bg="rgba(34,197,94,0.1)" />}
        {counts.partial > 0   && <Chip value={counts.partial}   label="partial"   color="#b45309" bg="rgba(251,191,36,0.1)" />}
        {counts.failed > 0    && <Chip value={counts.failed}    label="failed"    color="#dc2626" bg="rgba(239,68,68,0.1)" />}
        {counts.skipped > 0   && <Chip value={counts.skipped}   label="skipped"   color="#64748b" bg="rgba(148,163,184,0.1)" />}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {depFailures.length > 0 && (
            <button
              onClick={() => onRetry(depFailures.map((r) => r.id))}
              disabled={isRetrying}
              style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 12px", color: "#7c3aed", borderColor: "#e9d5ff", opacity: isRetrying ? 0.6 : 1 }}
            >
              {isRetrying ? "Retrying…" : `Retry ${depFailures.length} dep. ${depFailures.length === 1 ? "failure" : "failures"}`}
            </button>
          )}
          <button
            onClick={() => {
              const slug = entityLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();
              downloadCsv(
                migrateResultsToCsvRows(latest, entityType),
                `migration-results-${slug}-${new Date().toISOString().slice(0, 10)}.csv`,
              );
            }}
            style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 12px" }}
          >
            Export Results
          </button>
        </div>
      </div>

      {/* Per-item rows */}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {latest.map((r, i) => {
          const info = humanStatus(r.status, r.snippet);
          const isExpanded = expandedIds.has(r.id);
          const itemHistory = allRuns[r.id] ?? [];
          const hasHistory = itemHistory.length > 0;
          return (
            <div key={r.id} style={{ borderBottom: i < latest.length - 1 ? "1px solid #f1f5f9" : "none" }}>
              <div
                style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 20px", cursor: hasHistory ? "pointer" : "default" }}
                onClick={() => hasHistory && toggleExpand(r.id)}
              >
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: info.bg, color: info.color, flexShrink: 0, marginTop: 1 }}>
                  {info.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f1623", marginBottom: 1 }}>{r.name || r.id}</div>
                  <div style={{ fontSize: 11, color: "#8a9bb0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {info.description}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginTop: 1 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{formatTime(r.ranAt)}</span>
                  {hasHistory && (
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{isExpanded ? "▲" : "▼"} history</span>
                  )}
                </div>
              </div>

              {/* Expandable history */}
              {isExpanded && itemHistory.length > 0 && (
                <div style={{ background: "#f8fafc", borderTop: "1px solid #f1f5f9", padding: "8px 20px 8px 46px" }}>
                  {itemHistory.map((run, hi) => {
                    const hi2 = humanStatus(run.status, run.snippet);
                    return (
                      <div key={hi} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: hi < itemHistory.length - 1 ? "1px solid #eef3f8" : "none" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: hi2.bg, color: hi2.color, flexShrink: 0 }}>
                          {hi2.label}
                        </span>
                        <span style={{ fontSize: 11, color: "#8a9bb0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {hi2.description}
                        </span>
                        <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>{formatDate(run.run_at)} {formatTime(run.run_at)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Real errors callout */}
      {realErrors.length > 0 && (
        <div style={{ margin: "12px 20px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
            {realErrors.length} {realErrors.length === 1 ? "error needs" : "errors need"} human review
          </div>
          {realErrors.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 4, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>{r.name || r.id}</span>{" — "}
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{r.snippet.replace(/^ERRORS?:\s*/i, "").slice(0, 200)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Adflo Reassignment ────────────────────────────────────────────────

function ReassignmentTab({
  instanceId,
  extractions,
}: {
  instanceId: string;
  extractions: Record<string, ExtractionItem[]>;
}) {
  const taskForms = extractions["task"] ?? [];
  const workflows = extractions["workflow"] ?? [];

  // ── AI Analysis state ──────────────────────────────────────────────────────
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [proposals, setProposals] = useState<AnalysisProposal[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [approvalMap, setApprovalMap] = useState<Record<string, "approved" | "skipped" | undefined>>({});
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { parentId: string; parentName: string }>>({});
  const [executing, setExecuting] = useState(false);
  const [execResults, setExecResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // ── Manual queue state ─────────────────────────────────────────────────────
  const [taskInput, setTaskInput] = useState("");
  const [taskResolved, setTaskResolved] = useState<ExtractionItem | null>(null);
  const [taskNotFound, setTaskNotFound] = useState(false);

  const [targetInput, setTargetInput] = useState("");
  const [targetResolved, setTargetResolved] = useState<ExtractionItem | null>(null);
  const [targetNotFound, setTargetNotFound] = useState(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);

  // ── AI Analysis handlers ───────────────────────────────────────────────────

  const resetAnalysis = () => {
    setAnalysisState("idle");
    setProposals([]);
    setAnalysisSummary(null);
    setAnalysisError(null);
    setApprovalMap({});
    setConflictResolutions({});
    setExecResults({});
  };

  const setMode = (newUnassignedOnly: boolean) => {
    if (newUnassignedOnly === unassignedOnly) return;
    setUnassignedOnly(newUnassignedOnly);
    if (analysisState === "done" || analysisState === "error") resetAnalysis();
  };

  const runAnalysis = async () => {
    setAnalysisState("loading");
    setAnalysisError(null);
    setProposals([]);
    setAnalysisSummary(null);
    setApprovalMap({});
    setConflictResolutions({});
    setExecResults({});

    try {
      const res = await fetch("/api/adflo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, unassignedOnly }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalysisState("error");
        setAnalysisError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setProposals(data.proposals ?? []);
      setAnalysisSummary(data.summary ?? null);
      // Auto-approve high-confidence proposals that have a resolved parent
      const autoApprove: Record<string, "approved" | "skipped"> = {};
      for (const p of (data.proposals ?? []) as AnalysisProposal[]) {
        if (p.status === "proposed" && p.proposedParentId && p.confidence === "high") {
          autoApprove[p.taskFormId] = "approved";
        }
      }
      setApprovalMap(autoApprove);
      setAnalysisState("done");
    } catch (e) {
      setAnalysisState("error");
      setAnalysisError(String(e));
    }
  };

  const setApproval = (id: string, action: "approved" | "skipped" | undefined) =>
    setApprovalMap(prev => ({ ...prev, [id]: action }));

  const resolveConflict = (id: string, opt: ConflictOption) => {
    if (!opt.adfloId) return;
    setConflictResolutions(prev => ({ ...prev, [id]: { parentId: opt.adfloId!, parentName: opt.adfloName ?? "" } }));
    setApprovalMap(prev => ({ ...prev, [id]: "approved" }));
  };

  const clearConflict = (id: string) => {
    setConflictResolutions(prev => { const n = { ...prev }; delete n[id]; return n; });
    setApprovalMap(prev => ({ ...prev, [id]: undefined }));
  };

  const isReadyToExecute = (p: AnalysisProposal) =>
    !execResults[p.taskFormId] &&
    approvalMap[p.taskFormId] === "approved" &&
    (p.status === "conflict" ? !!conflictResolutions[p.taskFormId] : !!p.proposedParentId);

  const executeApproved = async () => {
    const toRun = proposals.filter(isReadyToExecute);
    if (!toRun.length) return;
    setExecuting(true);

    let successCount = 0;

    for (const p of toRun) {
      const resolution = conflictResolutions[p.taskFormId];
      const parentId   = resolution?.parentId   ?? p.proposedParentId;
      const parentName = resolution?.parentName ?? p.proposedParentName;

      const taskFormId = String(p.taskFormId ?? "").trim();
      if (!taskFormId) {
        console.error("[executeApproved] taskFormId missing for proposal:", p);
        setExecResults(prev => ({ ...prev, [p.taskFormId]: { success: false, message: `Internal error: taskFormId is missing (proposal: ${p.taskFormName})` } }));
        continue;
      }
      console.log("[executeApproved] Sending:", { taskFormId, parentId, parentName, parentEntityType: p.parentEntityType });

      try {
        const res = await fetch("/api/adflo/assign-task-form-parent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId,
            taskFormId,
            newParentFormId:   parentId,
            newParentFormName: parentName,
            parentEntityType:  p.parentEntityType,
          }),
        });
        const data = await res.json();
        const ok = !!data.success;
        if (ok) successCount++;
        setExecResults((prev) => ({
          ...prev,
          [p.taskFormId]: {
            success: ok,
            message: data.snippet ?? data.error ?? (res.ok ? "Done" : `HTTP ${res.status}`),
          },
        }));
      } catch (e) {
        setExecResults((prev) => ({
          ...prev,
          [p.taskFormId]: { success: false, message: String(e) },
        }));
      }
    }

    setExecuting(false);

    // Auto-refresh analysis so successfully assigned forms are no longer listed.
    if (successCount > 0) {
      runAnalysis();
    }
  };

  const approvedCount = proposals.filter(isReadyToExecute).length;
  const executedCount = Object.keys(execResults).length;

  // ── Manual queue handlers ──────────────────────────────────────────────────

  const resolveTask = () => {
    const q = taskInput.trim();
    if (!q) { setTaskResolved(null); setTaskNotFound(false); return; }
    const match = taskForms.find((i) => i.item_id === q || i.item_name.toLowerCase() === q.toLowerCase());
    setTaskResolved(match ?? null);
    setTaskNotFound(!match);
  };

  const resolveTarget = () => {
    const q = targetInput.trim();
    if (!q) { setTargetResolved(null); setTargetNotFound(false); return; }
    const match = workflows.find((i) => i.item_id === q || i.item_name.toLowerCase() === q.toLowerCase());
    setTargetResolved(match ?? null);
    setTargetNotFound(!match);
  };

  const canAdd =
    !!taskResolved &&
    !!targetResolved &&
    !queue.some((q) => q.taskFormId === taskResolved!.item_id && q.targetWorkflowId === targetResolved!.item_id);

  const addToQueue = () => {
    if (!taskResolved || !targetResolved) return;
    setQueue((prev) => [
      ...prev,
      {
        taskFormId: taskResolved.item_id,
        taskFormName: taskResolved.item_name,
        currentWorkflow: taskResolved.reference_table ?? "Unknown",
        targetWorkflowId: targetResolved.item_id,
        targetWorkflowName: targetResolved.item_name,
        status: "pending",
      },
    ]);
    setTaskInput(""); setTaskResolved(null); setTaskNotFound(false);
    setTargetInput(""); setTargetResolved(null); setTargetNotFound(false);
  };

  const runAll = async () => {
    const pending = queue.filter((q) => q.status === "pending");
    if (!pending.length) return;
    setRunning(true);

    for (const item of pending) {
      const key = `${item.taskFormId}::${item.targetWorkflowId}`;
      setQueue((prev) => prev.map((q) => `${q.taskFormId}::${q.targetWorkflowId}` === key ? { ...q, status: "running" } : q));

      try {
        const res = await fetch("/api/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId,
            entityType: "task_form_parent",
            items: [{ id: item.taskFormId, name: item.taskFormName, referenceTable: item.targetWorkflowId }],
            pendingOnly: false,
          }),
        });
        const data = await res.json();
        const result = data.results?.[0];
        const done = result?.status === "success" || result?.status === "partial_success";
        setQueue((prev) => prev.map((q) => `${q.taskFormId}::${q.targetWorkflowId}` === key
          ? { ...q, status: done ? "done" : "failed", resultSnippet: result?.snippet ?? "" }
          : q
        ));
      } catch (err) {
        setQueue((prev) => prev.map((q) => `${q.taskFormId}::${q.targetWorkflowId}` === key
          ? { ...q, status: "failed", resultSnippet: String(err) }
          : q
        ));
      }
    }

    setRunning(false);
  };

  const pendingCount = queue.filter((q) => q.status === "pending").length;

  // ── Confidence badge helper ────────────────────────────────────────────────

  const confidenceBadge = (c: AnalysisProposal["confidence"]) => {
    const map = {
      high:   { label: "High",   color: "#16a34a", bg: "rgba(34,197,94,0.12)" },
      medium: { label: "Medium", color: "#b45309", bg: "rgba(251,191,36,0.12)" },
      low:    { label: "Low",    color: "#dc2626", bg: "rgba(239,68,68,0.12)" },
    };
    if (!c || !map[c]) return null;
    const s = map[c];
    return (
      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: s.bg, color: s.color }}>
        {s.label}
      </span>
    );
  };

  return (
    <div>

      {/* ── AI Analysis card ── */}
      <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: analysisState !== "idle" ? "1px solid #dde5ef" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f1623" }}>AI-Powered Task Form Parent Assignment</div>
            <div style={{ fontSize: 13, color: "#627286", marginTop: 3 }}>
              {unassignedOnly
                ? "Analyzes Classic workflows to propose parent form assignments for unassigned Adflo task forms."
                : "Analyzes Classic workflows to propose or update parent form assignments for all Adflo task forms."}
            </div>
            {/* Mode toggle */}
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#8a9bb0", marginRight: 2 }}>Show:</span>
              {(["unassigned", "all"] as const).map((mode) => {
                const active = mode === "unassigned" ? unassignedOnly : !unassignedOnly;
                return (
                  <button
                    key={mode}
                    onClick={() => setMode(mode === "unassigned")}
                    disabled={analysisState === "loading"}
                    style={{
                      fontSize: 12, padding: "3px 12px", borderRadius: 999, cursor: "pointer",
                      border: active ? "1.5px solid #2f6fed" : "1.5px solid #dde5ef",
                      background: active ? "rgba(47,111,237,0.08)" : "#fff",
                      color: active ? "#2f6fed" : "#627286",
                      fontWeight: active ? 600 : 400,
                      transition: "all 0.15s",
                    }}
                  >
                    {mode === "unassigned" ? "Unassigned only" : "All task forms"}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={runAnalysis}
            disabled={analysisState === "loading"}
            style={{ ...primaryBtnStyle, opacity: analysisState === "loading" ? 0.6 : 1 }}
          >
            {analysisState === "loading" ? "Analyzing…" : analysisState === "done" ? "Re-run Analysis" : "Run Analysis"}
          </button>
        </div>

        {/* Error */}
        {analysisState === "error" && (
          <div style={{ padding: "14px 20px", color: "#dc2626", fontSize: 13 }}>
            Analysis failed: {analysisError}
          </div>
        )}

        {/* Summary chips */}
        {analysisState === "done" && analysisSummary && (
          <div style={{ padding: "14px 20px", display: "flex", gap: 10, flexWrap: "wrap", borderBottom: proposals.length ? "1px solid #eef3f8" : "none" }}>
            <Chip value={analysisSummary.totalAnalyzed} label={unassignedOnly ? "unassigned" : "total"} color="#455468" bg="rgba(148,163,184,0.1)" />
            <Chip value={analysisSummary.proposed}  label="proposed"  color="#2f6fed" bg="rgba(47,111,237,0.10)" />
            <Chip value={analysisSummary.conflicts} label="conflicts" color="#b45309" bg="rgba(251,191,36,0.12)" />
            <Chip value={analysisSummary.notFound}  label="not found" color="#64748b" bg="rgba(148,163,184,0.12)" />
          </div>
        )}

        {/* Proposals table */}
        {analysisState === "done" && proposals.length > 0 && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: unassignedOnly ? 1000 : 1140, borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: unassignedOnly ? "18%" : "15%" }} />
                  {!unassignedOnly && <col style={{ width: "16%" }} />}
                  <col style={{ width: unassignedOnly ? "24%" : "19%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: unassignedOnly ? "22%" : "18%" }} />
                  <col style={{ width: unassignedOnly ? "30%" : "26%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={thStyle}>Task Form</th>
                    {!unassignedOnly && <th style={thStyle}>Current Parent</th>}
                    <th style={thStyle}>Proposed Parent</th>
                    <th style={thStyle}>Conf.</th>
                    <th style={thStyle}>Reasoning</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => {
                    const approval   = approvalMap[p.taskFormId];
                    const result     = execResults[p.taskFormId];
                    const resolution = conflictResolutions[p.taskFormId];
                    const isAutoApproved = approval === "approved" && p.confidence === "high" && !resolution;

                    // ── Row tint ──
                    let rowBg = "transparent";
                    if (result)               rowBg = result.success ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)";
                    else if (approval === "approved") rowBg = "rgba(34,197,94,0.04)";
                    else if (approval === "skipped")  rowBg = "rgba(148,163,184,0.06)";

                    return (
                      <tr key={p.taskFormId} style={{ borderTop: "1px solid #eef3f8", background: rowBg, verticalAlign: "top" }}>

                        {/* Task Form */}
                        <td style={{ ...tdStyle, paddingTop: 12 }}>
                          <div title={p.taskFormName} style={{ fontWeight: 600, color: "#0f1623", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.taskFormName}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>#{p.taskFormId}</div>
                        </td>

                        {/* Current Parent (All task forms mode only) */}
                        {!unassignedOnly && (
                          <td style={{ ...tdStyle, paddingTop: 12 }}>
                            {p.currentParentId ? (
                              <>
                                <div title={p.currentParentName ?? undefined} style={{ fontWeight: 500, color: "#0f1623", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.currentParentName ?? "—"}</div>
                                <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>#{p.currentParentId}</div>
                              </>
                            ) : (
                              <span style={{ fontSize: 12, color: "#94a3b8" }}>None</span>
                            )}
                          </td>
                        )}

                        {/* Proposed Parent / Conflict options */}
                        <td style={{ ...tdStyle, paddingTop: 12 }}>
                          {p.status === "conflict" ? (
                            result ? (
                              // After execution — show what was picked
                              <>
                                <div style={{ fontWeight: 600, color: "#0f1623", fontSize: 13 }}>{resolution?.parentName ?? "—"}</div>
                                <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>#{resolution?.parentId}</div>
                              </>
                            ) : (
                              // Conflict picker
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                  {(p.conflictOptions?.length ?? 0)} options — pick one
                                </div>
                                {(p.conflictOptions ?? []).map((opt) => {
                                  const isSelected = resolution?.parentId === opt.adfloId && !!opt.adfloId;
                                  const canPick    = !!opt.adfloId;
                                  return (
                                    <label
                                      key={opt.classicProductName}
                                      style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 6, cursor: canPick ? "pointer" : "default", opacity: canPick ? 1 : 0.5 }}
                                    >
                                      <input
                                        type="radio"
                                        name={`conflict-${p.taskFormId}`}
                                        checked={isSelected}
                                        disabled={!canPick || !!result}
                                        onChange={() => canPick && resolveConflict(p.taskFormId, opt)}
                                        style={{ marginTop: 2, accentColor: "#2f6fed", flexShrink: 0 }}
                                      />
                                      <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                                        <span style={{ color: "#627286" }}>{opt.classicProductName}</span>
                                        {canPick && (
                                          <>
                                            <span style={{ color: "#94a3b8" }}> → </span>
                                            <span style={{ fontWeight: 600, color: "#0f1623" }}>{opt.adfloName}</span>
                                          </>
                                        )}
                                        {!canPick && <span style={{ color: "#94a3b8", fontSize: 11 }}> (no Adflo match)</span>}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            )
                          ) : p.proposedParentId ? (
                            <>
                              <div title={p.proposedParentName ?? undefined} style={{ fontWeight: 600, color: "#0f1623", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.proposedParentName}</div>
                              <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>#{p.proposedParentId}</div>
                            </>
                          ) : (
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>Not found in Classic</span>
                          )}
                        </td>

                        {/* Confidence */}
                        <td style={{ ...tdStyle, paddingTop: 14 }}>{confidenceBadge(p.confidence)}</td>

                        {/* Reasoning */}
                        <td title={p.reasoning} style={{ ...tdStyle, fontSize: 12, color: "#627286", paddingTop: 12, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>
                          {p.reasoning}
                        </td>

                        {/* Action */}
                        <td style={{ ...tdStyle, paddingTop: 12 }}>
                          {result ? (
                            // Execution result
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: result.success ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: result.success ? "#16a34a" : "#dc2626" }}>
                                {result.success ? "Done" : "Failed"}
                              </span>
                              <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 4, wordBreak: "break-word" }}>{result.message}</div>
                            </div>

                          ) : p.status === "conflict" ? (
                            // Conflict action
                            approval === "skipped" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(148,163,184,0.15)", color: "#64748b", alignSelf: "flex-start" }}>Skipped</span>
                                <button onClick={() => setApproval(p.taskFormId, undefined)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Undo</button>
                              </div>
                            ) : resolution ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#16a34a", alignSelf: "flex-start" }}>Approved</span>
                                <button onClick={() => clearConflict(p.taskFormId)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Change</button>
                                <button onClick={() => { clearConflict(p.taskFormId); setApproval(p.taskFormId, "skipped"); }} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", color: "#64748b", alignSelf: "flex-start" }}>Skip</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, color: "#b45309" }}>← Select a parent</span>
                                <button onClick={() => setApproval(p.taskFormId, "skipped")} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", color: "#64748b", alignSelf: "flex-start" }}>Skip</button>
                              </div>
                            )

                          ) : p.status === "not_found" ? (
                            // Not found — can only skip
                            approval === "skipped" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(148,163,184,0.15)", color: "#64748b", alignSelf: "flex-start" }}>Skipped</span>
                                <button onClick={() => setApproval(p.taskFormId, undefined)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Undo</button>
                              </div>
                            ) : (
                              <button onClick={() => setApproval(p.taskFormId, "skipped")} style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 10px", color: "#64748b" }}>Skip</button>
                            )

                          ) : p.proposedParentId ? (
                            // Proposed row with a parent ID — full approve/skip
                            approval === "approved" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#16a34a", alignSelf: "flex-start" }}>
                                  {isAutoApproved ? "Auto-approved" : "Approved"}
                                </span>
                                <button onClick={() => setApproval(p.taskFormId, undefined)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Undo</button>
                              </div>
                            ) : approval === "skipped" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(148,163,184,0.15)", color: "#64748b", alignSelf: "flex-start" }}>Skipped</span>
                                <button onClick={() => setApproval(p.taskFormId, undefined)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Undo</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => setApproval(p.taskFormId, "approved")} style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 10px", color: "#16a34a", borderColor: "#86efac" }}>Approve</button>
                                <button onClick={() => setApproval(p.taskFormId, "skipped")} style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 10px", color: "#64748b" }}>Skip</button>
                              </div>
                            )

                          ) : (
                            // Proposed but no Adflo match — skip only
                            approval === "skipped" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(148,163,184,0.15)", color: "#64748b", alignSelf: "flex-start" }}>Skipped</span>
                                <button onClick={() => setApproval(p.taskFormId, undefined)} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px", alignSelf: "flex-start" }}>Undo</button>
                              </div>
                            ) : (
                              <button onClick={() => setApproval(p.taskFormId, "skipped")} style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 10px", color: "#64748b" }}>Skip</button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Execute bar */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid #eef3f8", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={executeApproved}
                disabled={executing || approvedCount === 0}
                style={{ ...primaryBtnStyle, opacity: executing || approvedCount === 0 ? 0.5 : 1 }}
              >
                {executing ? "Executing…" : `Execute Approved (${approvedCount})`}
              </button>
              {executedCount > 0 && (
                <>
                  <span style={{ fontSize: 13, color: "#627286" }}>
                    {Object.values(execResults).filter(r => r.success).length} of {executedCount} succeeded
                  </span>
                  <button
                    onClick={() => {
                      const rows = proposals
                        .filter((p) => execResults[p.taskFormId])
                        .map((p) => {
                          const r = execResults[p.taskFormId];
                          return {
                            entity_type:  "Task Form Parent",
                            item_name:    p.taskFormName,
                            item_id:      p.taskFormId,
                            status:       r.success ? "succeeded" : "failed",
                            description:  r.message,
                            http_code:    "",
                            snippet:      r.message,
                            timestamp:    new Date().toISOString(),
                            is_retry:     "no",
                          };
                        });
                      downloadCsv(rows, `reassignment-results-${new Date().toISOString().slice(0, 10)}.csv`);
                    }}
                    style={{ ...ghostBtnStyle, fontSize: 12, marginLeft: "auto" }}
                  >
                    Export Results
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {analysisState === "done" && proposals.length === 0 && (
          <div style={{ padding: "24px 20px", fontSize: 13, color: "#8a9bb0", textAlign: "center" }}>
            No unassigned task forms found.
          </div>
        )}
      </div>

      {/* ── Manual queue card ── */}
      <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f1623", marginBottom: 4 }}>Manual Reassignment Queue</div>
        <div style={{ fontSize: 13, color: "#627286", marginBottom: 16 }}>
          For conflicts or forms not covered by AI analysis — add individual task form reassignments here.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Task Form (name or ID)</label>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              placeholder="e.g. 'Ad Trafficking Task' or 42"
              value={taskInput}
              onChange={(e) => { setTaskInput(e.target.value); setTaskResolved(null); setTaskNotFound(false); }}
              onBlur={resolveTask}
            />
            {taskResolved && (
              <div style={{ marginTop: 5, fontSize: 12, color: "#16a34a" }}>
                ✓ {taskResolved.item_name} (#{taskResolved.item_id})
                {taskResolved.reference_table && ` · Parent: ${taskResolved.reference_table}`}
              </div>
            )}
            {taskNotFound && (
              <div style={{ marginTop: 5, fontSize: 12, color: "#dc2626" }}>Not found in extracted task forms</div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Target Workflow (name or ID)</label>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              placeholder="e.g. 'Display Workflow' or 7"
              value={targetInput}
              onChange={(e) => { setTargetInput(e.target.value); setTargetResolved(null); setTargetNotFound(false); }}
              onBlur={resolveTarget}
            />
            {targetResolved && (
              <div style={{ marginTop: 5, fontSize: 12, color: "#16a34a" }}>
                ✓ {targetResolved.item_name} (#{targetResolved.item_id})
              </div>
            )}
            {targetNotFound && (
              <div style={{ marginTop: 5, fontSize: 12, color: "#dc2626" }}>Not found in extracted workflows</div>
            )}
          </div>
        </div>

        <button onClick={addToQueue} disabled={!canAdd} style={{ ...primaryBtnStyle, opacity: canAdd ? 1 : 0.45 }}>
          Add to Queue
        </button>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623" }}>
              Queue{pendingCount > 0 ? ` — ${pendingCount} pending` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setQueue([])} style={{ ...ghostBtnStyle, fontSize: 12, color: "#dc2626", borderColor: "#fecaca" }}>Clear all</button>
              <button
                onClick={runAll}
                disabled={running || pendingCount === 0}
                style={{ ...primaryBtnStyle, fontSize: 12, padding: "6px 16px", opacity: running || pendingCount === 0 ? 0.5 : 1 }}
              >
                {running ? "Running…" : "Run All"}
              </button>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={thStyle}>Task Form</th>
                <th style={thStyle}>Current Parent</th>
                <th style={thStyle}>Target Workflow</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item, i) => {
                const si = {
                  pending: { label: "Pending",  color: "#64748b", bg: "rgba(148,163,184,0.1)" },
                  running: { label: "Running…", color: "#2f6fed", bg: "rgba(47,111,237,0.1)" },
                  done:    { label: "Done",     color: "#16a34a", bg: "rgba(34,197,94,0.1)" },
                  failed:  { label: "Failed",   color: "#dc2626", bg: "rgba(239,68,68,0.1)" },
                }[item.status];
                return (
                  <tr key={i} style={{ borderTop: "1px solid #eef3f8" }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: "#0f1623", fontSize: 13 }}>{item.taskFormName}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>#{item.taskFormId}</div>
                    </td>
                    <td style={tdStyle}><span style={{ fontSize: 13, color: "#455468" }}>{item.currentWorkflow}</span></td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: "#0f1623", fontSize: 13 }}>{item.targetWorkflowName}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>#{item.targetWorkflowId}</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: si.bg, color: si.color }}>
                        {si.label}
                      </span>
                      {item.resultSnippet && (
                        <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 3, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.resultSnippet}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function Chip({ value, label, color, bg }: { value: number; label: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 999, color, background: bg }}>
      {value} {label}
    </span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#627286",
  textTransform: "uppercase", letterSpacing: "0.06em", display: "block",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 10, border: "1px solid #dde5ef",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 10, border: "1px solid #dde5ef",
  fontSize: 13.5, color: "#0f1623", background: "#fff", outline: "none",
  cursor: "pointer", width: "100%", fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 10, border: "none",
  background: "#2f6fed", color: "#fff", fontWeight: 700,
  fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 8, border: "1px solid #dde5ef",
  background: "transparent", color: "#455468", fontWeight: 600,
  fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
};

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "10px 20px",
  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.06em", color: "#94a3b8",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 20px", fontSize: 14, verticalAlign: "middle",
};
