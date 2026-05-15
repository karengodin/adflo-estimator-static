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
  status: string;
  snippet: string;
  run_at: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { key: "lookup_type", label: "Lookup Types" },
  { key: "client",      label: "Client Forms" },
  { key: "order",       label: "Order Forms" },
  { key: "line_item",   label: "Product Forms" },
  { key: "flight",      label: "Flight Forms" },
  { key: "task",        label: "Task Forms" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "28px 24px" }}>
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
            <select value={selectedInstanceId} onChange={(e) => setSelectedInstanceId(e.target.value)} style={selectStyle}>
              <option value="">Select an instance…</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </select>
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
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});

  const handleExtract = async (entityType: string) => {
    setExtracting((p) => ({ ...p, [entityType]: true }));
    try {
      await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, entityType }),
      });
      onRefresh(true);
    } finally {
      setExtracting((p) => ({ ...p, [entityType]: false }));
    }
  };

  const isAnyExtracting = Object.values(extracting).some(Boolean);

  const getLastExtracted = (entityType: string) =>
    (extractions[entityType] ?? []).reduce<string | null>(
      (latest, item) => (!latest || item.created_at > latest ? item.created_at : latest),
      null
    );

  return (
    <>
      {/* ── Extraction status card ── */}
      <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623" }}>Extraction Status</div>
          <button
            onClick={async () => { for (const { key } of ENTITY_TYPES) await handleExtract(key); }}
            disabled={isAnyExtracting}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "7px 14px", opacity: isAnyExtracting ? 0.6 : 1 }}
          >
            {isAnyExtracting ? "Extracting…" : "Extract All"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {ENTITY_TYPES.map(({ key, label }, i) => {
            const count = extractions[key]?.length ?? 0;
            const isExtracting = !!extracting[key];
            return (
              <div key={key} style={{
                padding: "14px 18px",
                borderRight: (i + 1) % 3 !== 0 ? "1px solid #eef3f8" : "none",
                borderBottom: i < 3 ? "1px solid #eef3f8" : "none",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#627286", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#0f1623", lineHeight: 1, marginBottom: 3 }}>
                  {count > 0 ? count : "—"}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
                  {getLastExtracted(key) ? `Extracted ${formatDate(getLastExtracted(key))}` : "Not extracted"}
                </div>
                <button
                  onClick={() => handleExtract(key)}
                  disabled={isExtracting}
                  style={{ ...ghostBtnStyle, fontSize: 11, padding: "4px 10px", opacity: isExtracting ? 0.6 : 1 }}
                >
                  {isExtracting ? "Extracting…" : count > 0 ? "Re-extract" : "Extract"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Per-entity sections ── */}
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

  // Classic fetch state
  const [classicItems, setClassicItems] = useState<ClassicItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const pasteResolved = mode === "paste" && pasteInput.trim() ? resolveInput(pasteInput, items) : null;

  const toggleItem = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const selectAllPending = () =>
    setSelected(new Set(classicItems.filter((i) => latestRun[i.id]?.status !== "success").map((i) => i.id)));

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
                <button onClick={selectAllPending} style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}>Select all pending</button>
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
                {classicItems.map((item, i) => {
                  const run = latestRun[item.id];
                  const isChecked = selected.has(item.id);
                  const statusInfo = run ? humanStatus(run.status, run.snippet) : null;
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItem(item.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 20px",
                        borderBottom: i < classicItems.length - 1 ? "1px solid #f1f5f9" : "none",
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
  onRetry,
  isRetrying,
}: {
  results: MigrateResult[];
  allRuns: Record<string, MigrationRun[]>;
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
      <div style={{ padding: "10px 20px", background: "#f8fafc", borderBottom: "1px solid #eef3f8", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>RUN RESULTS</span>
        {counts.succeeded > 0 && <Chip value={counts.succeeded} label="succeeded" color="#16a34a" bg="rgba(34,197,94,0.1)" />}
        {counts.partial > 0   && <Chip value={counts.partial}   label="partial"   color="#b45309" bg="rgba(251,191,36,0.1)" />}
        {counts.failed > 0    && <Chip value={counts.failed}    label="failed"    color="#dc2626" bg="rgba(239,68,68,0.1)" />}
        {counts.skipped > 0   && <Chip value={counts.skipped}   label="skipped"   color="#64748b" bg="rgba(148,163,184,0.1)" />}
        {depFailures.length > 0 && (
          <button
            onClick={() => onRetry(depFailures.map((r) => r.id))}
            disabled={isRetrying}
            style={{ ...ghostBtnStyle, marginLeft: "auto", fontSize: 11, padding: "4px 12px", color: "#7c3aed", borderColor: "#e9d5ff", opacity: isRetrying ? 0.6 : 1 }}
          >
            {isRetrying ? "Retrying…" : `Retry ${depFailures.length} dep. ${depFailures.length === 1 ? "failure" : "failures"}`}
          </button>
        )}
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

  const [taskInput, setTaskInput] = useState("");
  const [taskResolved, setTaskResolved] = useState<ExtractionItem | null>(null);
  const [taskNotFound, setTaskNotFound] = useState(false);

  const [targetInput, setTargetInput] = useState("");
  const [targetResolved, setTargetResolved] = useState<ExtractionItem | null>(null);
  const [targetNotFound, setTargetNotFound] = useState(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);

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

  const noExtractedWarning = taskForms.length === 0 || workflows.length === 0;
  const pendingCount = queue.filter((q) => q.status === "pending").length;

  return (
    <div>
      {noExtractedWarning && (
        <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
          {taskForms.length === 0 && <span>Task forms not found. Click &ldquo;Fetch from Classic&rdquo; in the Task Forms section to load task form data. </span>}
          {workflows.length === 0 && <span>Workflows not found. Click &ldquo;Fetch from Classic&rdquo; in the Extraction Status card to load workflow data.</span>}
        </div>
      )}

      {/* Input form */}
      <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f1623", marginBottom: 16 }}>Add Reassignment to Queue</div>

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
                  pending: { label: "Pending",   color: "#64748b", bg: "rgba(148,163,184,0.1)" },
                  running: { label: "Running…",  color: "#2f6fed", bg: "rgba(47,111,237,0.1)" },
                  done:    { label: "Done",      color: "#16a34a", bg: "rgba(34,197,94,0.1)" },
                  failed:  { label: "Failed",    color: "#dc2626", bg: "rgba(239,68,68,0.1)" },
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
