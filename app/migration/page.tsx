"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";

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

type ItemHistory = {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { key: "lookup_type", label: "Lookup Types" },
  { key: "client",      label: "Client Forms" },
  { key: "order",       label: "Order Forms" },
  { key: "line_item",   label: "Product Forms" },
  { key: "flight",      label: "Flight Forms" },
  { key: "task",        label: "Task Forms" },
] as const;

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  success:                { label: "Success",       bg: "rgba(34,197,94,0.12)",   color: "#16a34a" },
  partial_success:        { label: "Partial",        bg: "rgba(251,191,36,0.12)",  color: "#b45309" },
  error:                  { label: "Error",          bg: "rgba(239,68,68,0.12)",   color: "#dc2626" },
  skipped:                { label: "Skipped",        bg: "rgba(148,163,184,0.12)", color: "#64748b" },
  needs_parent_selection: { label: "Needs Parent",  bg: "rgba(47,111,237,0.10)",  color: "#2f6fed" },
};

function isNoOpError(snippet: string) {
  return snippet.includes("NO-OP") || snippet.toLowerCase().includes("0 items added");
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MigrationPage() {
  // ── Instance state ─────────────────────────────────────────────────────────
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  // ── Data state ─────────────────────────────────────────────────────────────
  // Extractions: keyed by entityType → items
  const [extractions, setExtractions] = useState<Record<string, ExtractionItem[]>>({});
  const [extractionsLoading, setExtractionsLoading] = useState(false);
  // Latest migration run per item: entityType → itemId → history
  const [history, setHistory] = useState<Record<string, Record<string, ItemHistory>>>({});

  // ── Interaction state ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [migrating, setMigrating] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, MigrateResult[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── Load instances on mount ────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/tapclicks-instances")
      .then((r) => r.json())
      .then((data) => {
        setInstances(Array.isArray(data) ? data : []);
        setInstancesLoading(false);
      })
      .catch(() => setInstancesLoading(false));
  }, []);

  // ── Load extractions + migration history when instance changes ─────────────

  // showLoadingSpinner=false for background refreshes (e.g. after each extract)
  // so the content area stays mounted and doesn't flash.
  const loadData = useCallback(async (instanceId: string, showLoadingSpinner = true) => {
    if (!instanceId) return;
    if (showLoadingSpinner) setExtractionsLoading(true);

    // All extractions for this instance, grouped by entity_type
    const { data: extractionRows } = await supabase
      .from("extractions")
      .select("item_id, item_name, reference_table, entity_type, created_at")
      .eq("instance_id", instanceId)
      .not("item_id", "is", null)
      .order("item_name", { ascending: true });

    const byType: Record<string, ExtractionItem[]> = {};
    for (const row of extractionRows ?? []) {
      if (!byType[row.entity_type]) byType[row.entity_type] = [];
      byType[row.entity_type].push(row as ExtractionItem);
    }
    setExtractions(byType);

    // Latest migration run per (entity_type, item_id) — ordered DESC so first
    // occurrence per item is the most recent
    const { data: historyRows } = await supabase
      .from("migration_runs")
      .select("entity_type, item_id, status, snippet, run_at")
      .eq("instance_id", instanceId)
      .order("run_at", { ascending: false });

    const histMap: Record<string, Record<string, ItemHistory>> = {};
    for (const row of historyRows ?? []) {
      if (!histMap[row.entity_type]) histMap[row.entity_type] = {};
      // First occurrence = most recent run for this item
      if (!histMap[row.entity_type][row.item_id]) {
        histMap[row.entity_type][row.item_id] = {
          status: row.status ?? "",
          snippet: row.snippet ?? "",
          run_at: row.run_at,
        };
      }
    }
    setHistory(histMap);
    setExtractionsLoading(false);
  }, []);

  useEffect(() => {
    if (selectedInstanceId) {
      setResults({});
      setSelected({});
      setExpanded({});
      loadData(selectedInstanceId);
    }
  }, [selectedInstanceId, loadData]);

  // ── Extract one entity type ────────────────────────────────────────────────

  const handleExtract = async (entityType: string) => {
    if (!selectedInstanceId) return;
    setExtracting((prev) => ({ ...prev, [entityType]: true }));
    try {
      await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: selectedInstanceId, entityType }),
      });
      // Pass false so loadData updates extractions/history in the background
      // without toggling extractionsLoading, which would unmount the content area.
      await loadData(selectedInstanceId, false);
    } finally {
      setExtracting((prev) => ({ ...prev, [entityType]: false }));
    }
  };

  // ── Extract all entity types sequentially ──────────────────────────────────

  const handleExtractAll = async () => {
    console.log("[adfloMigrate] Extract All started", { instanceId: selectedInstanceId });
    for (const { key } of ENTITY_TYPES) {
      console.log("[adfloMigrate] Extracting:", key);
      await handleExtract(key);
      console.log("[adfloMigrate] Done extracting:", key, "→ items:", extractions[key]?.length ?? 0);
    }
    console.log("[adfloMigrate] Extract All complete");
  };

  const isAnyExtracting = Object.values(extracting).some(Boolean);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleItem = (entityType: string, itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev[entityType] ?? []);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return { ...prev, [entityType]: next };
    });
  };

  const selectAllPending = (entityType: string) => {
    const items = extractions[entityType] ?? [];
    const typeHistory = history[entityType] ?? {};
    const pendingIds = items
      .filter((item) => typeHistory[item.item_id]?.status !== "success")
      .map((item) => item.item_id);
    setSelected((prev) => ({ ...prev, [entityType]: new Set(pendingIds) }));
  };

  const clearSelection = (entityType: string) => {
    setSelected((prev) => ({ ...prev, [entityType]: new Set<string>() }));
  };

  // ── Migrate selected or specific items ────────────────────────────────────

  const handleMigrate = async (entityType: string, itemIds?: string[]) => {
    if (!selectedInstanceId) return;
    const items = extractions[entityType] ?? [];
    const ids = itemIds ?? [...(selected[entityType] ?? [])];
    if (ids.length === 0) return;

    const payload = ids
      .map((id) => items.find((i) => i.item_id === id))
      .filter(Boolean)
      .map((item) => ({
        id: item!.item_id,
        name: item!.item_name,
        referenceTable: item!.reference_table,
      }));

    setMigrating((prev) => ({ ...prev, [entityType]: true }));
    try {
      const res = await fetch("/api/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: selectedInstanceId,
          entityType,
          items: payload,
          pendingOnly: false,
        }),
      });
      const data = await res.json();
      setResults((prev) => ({ ...prev, [entityType]: data.results ?? [] }));
      // Refresh history so status badges on items reflect the new run
      await loadData(selectedInstanceId);
    } finally {
      setMigrating((prev) => ({ ...prev, [entityType]: false }));
    }
  };

  const handleRetryFailures = (entityType: string) => {
    const current = results[entityType] ?? [];
    // Latest result per id (retry overrides original)
    const latestById: Record<string, MigrateResult> = {};
    for (const r of current) latestById[r.id] = r;
    const retryIds = Object.values(latestById)
      .filter((r) => r.status === "error" && isNoOpError(r.snippet))
      .map((r) => r.id);
    if (retryIds.length > 0) handleMigrate(entityType, retryIds);
  };

  // ── Computed helpers ───────────────────────────────────────────────────────

  const getLastExtracted = (entityType: string): string | null => {
    const items = extractions[entityType];
    if (!items?.length) return null;
    return items.reduce<string | null>(
      (latest, item) => (!latest || item.created_at > latest ? item.created_at : latest),
      null
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        marginBottom: 24,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f1623" }}>
            adfloMigrate
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#627286" }}>
            Classic → Adflo migration
          </p>
        </div>

        {/* Instance selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 280 }}>
          <label style={labelStyle}>Instance</label>
          {instancesLoading ? (
            <span style={{ fontSize: 13, color: "#8a9bb0", padding: "10px 0" }}>Loading…</span>
          ) : instances.length === 0 ? (
            <span style={{ fontSize: 13, color: "#dc2626" }}>
              No instances found. Add one on the Instances page.
            </span>
          ) : (
            <select
              value={selectedInstanceId}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select an instance…</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {!selectedInstanceId && (
        <div style={{
          background: "#fff",
          border: "1px solid #dde5ef",
          borderRadius: 16,
          padding: "56px 32px",
          textAlign: "center",
          color: "#8a9bb0",
          fontSize: 14,
        }}>
          Select an instance above to begin.
        </div>
      )}

      {selectedInstanceId && extractionsLoading && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "#8a9bb0", fontSize: 14 }}>
          Loading…
        </div>
      )}

      {/* ── Main content (instance selected + data loaded) ─────────────────── */}
      {selectedInstanceId && !extractionsLoading && (
        <>
          {/* ── Extraction Status Card ───────────────────────────────────── */}
          <div style={{
            background: "#fff",
            border: "1px solid #dde5ef",
            borderRadius: 16,
            marginBottom: 20,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 20px",
              borderBottom: "1px solid #dde5ef",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623" }}>
                Extraction Status
              </div>
              <button
                onClick={handleExtractAll}
                disabled={isAnyExtracting}
                style={{
                  ...primaryBtnStyle,
                  fontSize: 12,
                  padding: "7px 14px",
                  opacity: isAnyExtracting ? 0.6 : 1,
                }}
              >
                {isAnyExtracting ? "Extracting…" : "Extract All"}
              </button>
            </div>

            {/* 3-column grid of entity types */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
              {ENTITY_TYPES.map(({ key, label }, i) => {
                const count = extractions[key]?.length ?? 0;
                const lastDate = getLastExtracted(key);
                const isExtracting = !!extracting[key];
                const borderRight = (i + 1) % 3 !== 0;
                const borderBottom = i < 3;
                return (
                  <div
                    key={key}
                    style={{
                      padding: "14px 18px",
                      borderRight: borderRight ? "1px solid #eef3f8" : "none",
                      borderBottom: borderBottom ? "1px solid #eef3f8" : "none",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#627286", marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#0f1623", lineHeight: 1, marginBottom: 3 }}>
                      {count > 0 ? count : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
                      {lastDate ? `Extracted ${formatDate(lastDate)}` : "Not extracted"}
                    </div>
                    <button
                      onClick={() => handleExtract(key)}
                      disabled={isExtracting}
                      style={{
                        ...ghostBtnStyle,
                        fontSize: 11,
                        padding: "4px 10px",
                        opacity: isExtracting ? 0.6 : 1,
                      }}
                    >
                      {isExtracting ? "Extracting…" : count > 0 ? "Re-extract" : "Extract"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Migration Checklist ──────────────────────────────────────── */}
          {ENTITY_TYPES.map(({ key, label }) => {
            const items = extractions[key] ?? [];
            const typeHistory = history[key] ?? {};
            const typeResults = results[key] ?? [];
            const selectedSet = selected[key] ?? new Set<string>();
            const isMigrating = !!migrating[key];
            const isExpanded = !!expanded[key];
            const hasResults = typeResults.length > 0;

            const successCount = items.filter(
              (item) => typeHistory[item.item_id]?.status === "success"
            ).length;
            const pendingCount = items.length - successCount;

            return (
              <div
                key={key}
                style={{
                  background: "#fff",
                  border: "1px solid #dde5ef",
                  borderRadius: 16,
                  marginBottom: 12,
                  overflow: "hidden",
                }}
              >
                {/* Section header row */}
                <div
                  style={{
                    padding: "13px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: items.length > 0 ? "pointer" : "default",
                    borderBottom: isExpanded || hasResults ? "1px solid #eef3f8" : "none",
                    userSelect: "none",
                  }}
                  onClick={() =>
                    items.length > 0 &&
                    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                >
                  <span style={{ fontSize: 11, color: "#94a3b8", width: 14, flexShrink: 0 }}>
                    {items.length > 0 ? (isExpanded ? "▼" : "▶") : "–"}
                  </span>

                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f1623", flex: 1 }}>
                    {label}
                  </span>

                  {/* Status chips */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {items.length === 0 && (
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>Not extracted</span>
                    )}
                    {successCount > 0 && (
                      <StatusChip value={successCount} label="done" color="#16a34a" bg="rgba(34,197,94,0.1)" />
                    )}
                    {pendingCount > 0 && items.length > 0 && (
                      <StatusChip value={pendingCount} label="pending" color="#627286" bg="rgba(148,163,184,0.1)" />
                    )}
                  </div>

                  {/* Migrate button */}
                  {items.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMigrate(key);
                      }}
                      disabled={isMigrating || selectedSet.size === 0}
                      style={{
                        ...primaryBtnStyle,
                        fontSize: 12,
                        padding: "6px 14px",
                        opacity: isMigrating || selectedSet.size === 0 ? 0.45 : 1,
                      }}
                    >
                      {isMigrating
                        ? "Migrating…"
                        : selectedSet.size > 0
                        ? `Migrate (${selectedSet.size})`
                        : "Migrate Selected"}
                    </button>
                  )}
                </div>

                {/* Item list (expanded) */}
                {isExpanded && items.length > 0 && (
                  <>
                    {/* Selection toolbar */}
                    <div style={{
                      padding: "7px 20px",
                      background: "#f8fafc",
                      borderBottom: "1px solid #eef3f8",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <button
                        onClick={() => selectAllPending(key)}
                        style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}
                      >
                        Select all pending
                      </button>
                      <button
                        onClick={() => clearSelection(key)}
                        style={{ ...ghostBtnStyle, fontSize: 11, padding: "3px 10px" }}
                      >
                        Clear
                      </button>
                      {selectedSet.size > 0 && (
                        <span style={{ fontSize: 12, color: "#627286" }}>
                          {selectedSet.size} selected
                        </span>
                      )}
                    </div>

                    {/* Scrollable item list */}
                    <div style={{ maxHeight: 300, overflowY: "auto" }}>
                      {items.map((item, i) => {
                        const itemHist = typeHistory[item.item_id];
                        const isChecked = selectedSet.has(item.item_id);
                        const isLast = i === items.length - 1;
                        const statusCfg = itemHist ? (STATUS_CONFIG[itemHist.status] ?? null) : null;
                        return (
                          <div
                            key={item.item_id}
                            onClick={() => toggleItem(key, item.item_id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 20px",
                              borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                              background: isChecked ? "rgba(47,111,237,0.03)" : "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleItem(key, item.item_id)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ accentColor: "#2f6fed", flexShrink: 0 }}
                            />
                            <span style={{
                              flex: 1,
                              fontSize: 13,
                              color: "#0f1623",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {item.item_name || item.item_id}
                            </span>
                            <span style={{
                              fontSize: 11,
                              color: "#94a3b8",
                              fontFamily: "'DM Mono', monospace",
                              flexShrink: 0,
                            }}>
                              #{item.item_id}
                            </span>
                            {statusCfg && (
                              <span style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: statusCfg.bg,
                                color: statusCfg.color,
                                flexShrink: 0,
                              }}>
                                {statusCfg.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Results panel (shown after a migration run on this type) */}
                {hasResults && (
                  <ResultsPanel
                    results={typeResults}
                    onRetry={() => handleRetryFailures(key)}
                    isRetrying={isMigrating}
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({
  results,
  onRetry,
  isRetrying,
}: {
  results: MigrateResult[];
  onRetry: () => void;
  isRetrying: boolean;
}) {
  // Overlay retry results on their originals so the list shows the latest
  // status per item. Both original and retry rows are in the results array
  // (isRetry distinguishes them); we display the latest per id.
  const latestById: Record<string, MigrateResult> = {};
  for (const r of results) latestById[r.id] = r; // later items (retries) win
  const latest = Object.values(latestById);

  const succeeded = latest.filter((r) => r.status === "success").length;
  const partial   = latest.filter((r) => r.status === "partial_success").length;
  const failed    = latest.filter((r) => r.status === "error").length;
  const skipped   = latest.filter((r) => r.status === "skipped").length;

  const noOpErrors  = latest.filter((r) => r.status === "error" && isNoOpError(r.snippet));
  const realErrors  = latest.filter((r) => r.status === "error" && !isNoOpError(r.snippet));

  return (
    <div style={{ borderTop: "1px solid #eef3f8" }}>

      {/* Summary bar */}
      <div style={{
        padding: "10px 20px",
        background: "#f8fafc",
        borderBottom: "1px solid #eef3f8",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>
          RUN RESULTS
        </span>
        {succeeded > 0  && <StatusChip value={succeeded} label="succeeded"  color="#16a34a" bg="rgba(34,197,94,0.1)"   />}
        {partial > 0    && <StatusChip value={partial}   label="partial"    color="#b45309" bg="rgba(251,191,36,0.1)"  />}
        {failed > 0     && <StatusChip value={failed}    label="failed"     color="#dc2626" bg="rgba(239,68,68,0.1)"   />}
        {skipped > 0    && <StatusChip value={skipped}   label="skipped"    color="#64748b" bg="rgba(148,163,184,0.1)" />}

        {noOpErrors.length > 0 && (
          <button
            onClick={onRetry}
            disabled={isRetrying}
            style={{
              ...ghostBtnStyle,
              marginLeft: "auto",
              fontSize: 11,
              padding: "4px 12px",
              color: "#b45309",
              borderColor: "#fde68a",
              opacity: isRetrying ? 0.6 : 1,
            }}
          >
            {isRetrying
              ? "Retrying…"
              : `Retry ${noOpErrors.length} dependency ${noOpErrors.length === 1 ? "failure" : "failures"}`}
          </button>
        )}
      </div>

      {/* Per-item result rows */}
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {latest.map((r, i) => {
          const cfg = STATUS_CONFIG[r.status] ?? { label: r.status, bg: "rgba(148,163,184,0.12)", color: "#64748b" };
          const isLast = i === latest.length - 1;
          return (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "9px 20px",
                borderBottom: isLast ? "none" : "1px solid #f1f5f9",
              }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 999,
                background: cfg.bg,
                color: cfg.color,
                flexShrink: 0,
                marginTop: 1,
              }}>
                {cfg.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0f1623", marginBottom: 2 }}>
                  {r.name || r.id}
                </div>
                {r.snippet && (
                  <div style={{
                    fontSize: 11,
                    color: "#8a9bb0",
                    fontFamily: "'DM Mono', monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {r.snippet}
                  </div>
                )}
              </div>
              {r.isRetry && (
                <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0, marginTop: 3 }}>
                  retry
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Real errors — need human review */}
      {realErrors.length > 0 && (
        <div style={{
          margin: "12px 20px",
          background: "rgba(239,68,68,0.05)",
          border: "1px solid rgba(239,68,68,0.15)",
          borderRadius: 10,
          padding: "12px 14px",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
            {realErrors.length} {realErrors.length === 1 ? "error needs" : "errors need"} human review
          </div>
          {realErrors.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 4, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>{r.name || r.id}</span>
              {" — "}
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                {r.snippet}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-component ─────────────────────────────────────────────────────

function StatusChip({
  value, label, color, bg,
}: {
  value: number; label: string; color: string; bg: string;
}) {
  return (
    <span style={{
      fontSize: 12,
      fontWeight: 600,
      padding: "2px 10px",
      borderRadius: 999,
      color,
      background: bg,
    }}>
      {value} {label}
    </span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#627286",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  fontSize: 13.5,
  color: "#0f1623",
  background: "#fff",
  outline: "none",
  cursor: "pointer",
  width: "100%",
  fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "none",
  background: "#2f6fed",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #dde5ef",
  background: "transparent",
  color: "#455468",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
