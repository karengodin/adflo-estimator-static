"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type MigrateStatus = "pending" | "success" | "partial_success" | "error";

interface RowResult {
  id: string;
  status: MigrateStatus;
  httpCode: number;
  snippet: string;
  ranAt: string;
}

interface TapClicksInstance {
  id: string;
  label: string;
  url: string;
}

interface SessionState {
  instanceId: string;
  instanceUrl: string;
  cookie: string;
  loggedInAt: number;
}

interface MigrationSection {
  key: string;
  label: string;
  migrationType: "lookuptype" | "entityform";
  entityType?: string;
  placeholder: string;
}

const SECTIONS: MigrationSection[] = [
  { key: "lookup",  label: "Lookup Types",  migrationType: "lookuptype",  placeholder: "Paste IDs, one per line\n12345\n67890\n..." },
  { key: "client",  label: "Client Forms",  migrationType: "entityform",  entityType: "client",    placeholder: "Paste form IDs, one per line" },
  { key: "order",   label: "Order Forms",   migrationType: "entityform",  entityType: "order",     placeholder: "Paste form IDs, one per line" },
  { key: "product", label: "Product Forms", migrationType: "entityform",  entityType: "line_item", placeholder: "Paste form IDs, one per line" },
  { key: "flight",  label: "Flight Forms",  migrationType: "entityform",  entityType: "flight",    placeholder: "Paste form IDs, one per line" },
  { key: "task",    label: "Task Forms",    migrationType: "entityform",  entityType: "task",      placeholder: "Paste form IDs, one per line" },
];

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const STATUS_META: Record<MigrateStatus, { label: string; color: string; bg: string; border: string }> = {
  success:         { label: "Success", color: "#1a7f4b", bg: "#edfaf3", border: "#b6ecd0" },
  partial_success: { label: "Partial",  color: "#a8611a", bg: "#fdf1e5", border: "#f1d3b2" },
  error:           { label: "Error",    color: "#c0392b", bg: "#fdf2f2", border: "#f5c6c6" },
  pending:         { label: "Pending",  color: "#627286", bg: "#f5f7fb", border: "#d8e1ec" },
};

function StatusBadge({ status }: { status: MigrateStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" as const, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      {m.label}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#627286", marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>Running…</span>
        <span>{done} / {total} — {pct}%</span>
      </div>
      <div style={{ height: 6, background: "#d8e1ec", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#2f6fed", borderRadius: 999, transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
}

function ResultsTable({ results }: { results: RowResult[] }) {
  if (results.length === 0) return null;
  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 14 }}>
        {Object.entries(counts).map(([status, count]) => {
          const m = STATUS_META[status as MigrateStatus] ?? STATUS_META.pending;
          return <span key={status} style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>{count} {status.replace("_", " ")}</span>;
        })}
      </div>
      <div style={{ overflowX: "auto" as const, border: "1px solid #d8e1ec", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f7fb", borderBottom: "1px solid #d8e1ec" }}>
              {["ID", "Status", "HTTP", "Snippet", "Ran At"].map((h) => (
                <th key={h} style={{ textAlign: "left" as const, padding: "8px 14px", color: "#627286", fontWeight: 700, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase" as const, whiteSpace: "nowrap" as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < results.length - 1 ? "1px solid #eef3f8" : "none", background: "#ffffff" }}>
                <td style={{ padding: "8px 14px", color: "#18212b", fontWeight: 600, whiteSpace: "nowrap" as const, fontFamily: "monospace" }}>{r.id}</td>
                <td style={{ padding: "8px 14px", whiteSpace: "nowrap" as const }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: "8px 14px", color: r.httpCode >= 400 || r.httpCode === 0 ? "#c0392b" : "#627286", whiteSpace: "nowrap" as const, fontFamily: "monospace" }}>{r.httpCode || "—"}</td>
                <td style={{ padding: "8px 14px", color: "#627286", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 12 }} title={r.snippet}>{r.snippet}</td>
                <td style={{ padding: "8px 14px", color: "#8fa3b8", whiteSpace: "nowrap" as const, fontSize: 12 }}>{new Date(r.ranAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MigrationPanel({ section, session, onSessionExpired }: { section: MigrationSection; session: SessionState | null; onSessionExpired: () => void }) {
  const [input, setInput] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const ids = input.split("\n").map((s) => s.trim()).filter(Boolean);
  const successStatuses = new Set(["success", "ok", "done"]);
  const doneIds = new Set(results.filter((r) => successStatuses.has(r.status)).map((r) => r.id));
  const idsToRun = pendingOnly ? ids.filter((id) => !doneIds.has(id)) : ids;
  const disabled = !session;

  async function run() {
    if (!session) { setError("No active session. Select and connect to an instance first."); return; }
    if (idsToRun.length === 0) return;
    setRunning(true);
    setError(null);
    abortRef.current = false;
    setProgress({ done: 0, total: idsToRun.length });
    const resultMap = new Map(results.map((r) => [r.id, r]));

    for (let i = 0; i < idsToRun.length; i++) {
      if (abortRef.current) break;
      const id = idsToRun[i];
      try {
        const res = await fetch("/api/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id], migrationType: section.migrationType, entityType: section.entityType, cookie: session.cookie, instanceUrl: session.instanceUrl }),
        });
        const data = await res.json();
        if (res.status === 401) { onSessionExpired(); setError("Session expired. Re-authenticate and retry."); abortRef.current = true; break; }
        const row: RowResult = data.results?.[0] ?? { id, status: "error" as MigrateStatus, httpCode: 0, snippet: "No result", ranAt: new Date().toISOString() };
        if (row.httpCode === 401) { onSessionExpired(); setError("Session expired. Re-authenticate and retry."); abortRef.current = true; break; }
        resultMap.set(id, row);
      } catch (err) {
        resultMap.set(id, { id, status: "error" as MigrateStatus, httpCode: 0, snippet: String(err), ranAt: new Date().toISOString() });
      }
      setProgress({ done: i + 1, total: idsToRun.length });
      setResults(ids.map((id) => resultMap.get(id)).filter(Boolean) as RowResult[]);
    }
    setRunning(false);
  }

  function exportCsv() {
    const rows = results.map((r) => [r.id, r.status, r.httpCode, `"${r.snippet.replace(/"/g, '""')}"`, r.ranAt].join(","));
    const blob = new Blob([["id,status,http_code,snippet,ran_at", ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${section.key}-migration-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ background: "#ffffff", border: "1px solid #d8e1ec", borderRadius: 18, padding: 28, marginBottom: 20, boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.04)", opacity: disabled ? 0.5 : 1, transition: "opacity 0.2s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#18212b", letterSpacing: "-0.01em" }}>{section.label}</h2>
          {section.entityType && <span style={{ fontSize: 11, color: "#2f6fed", background: "rgba(47,111,237,0.08)", padding: "2px 8px", borderRadius: 6, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, border: "1px solid rgba(47,111,237,0.15)" }}>{section.entityType}</span>}
        </div>
        <span style={{ fontSize: 12, color: "#8fa3b8" }}>{ids.length} ID{ids.length !== 1 ? "s" : ""}</span>
      </div>

      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={disabled ? "Connect to an instance above first…" : section.placeholder} disabled={running || disabled} rows={4}
        style={{ width: "100%", boxSizing: "border-box" as const, background: "#f5f7fb", border: "1px solid #d8e1ec", borderRadius: 10, color: "#18212b", fontFamily: "monospace", fontSize: 13, padding: "10px 14px", resize: "vertical" as const, outline: "none", marginBottom: 14, lineHeight: 1.7 }}
        onFocus={(e) => { if (!disabled) e.target.style.borderColor = "#2f6fed"; }} onBlur={(e) => (e.target.style.borderColor = "#d8e1ec")} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#455468", cursor: "pointer", userSelect: "none" as const }}>
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} disabled={running || disabled} style={{ accentColor: "#2f6fed" }} />
          Skip already-succeeded IDs
        </label>
        <div style={{ flex: 1 }} />
        {results.length > 0 && <button onClick={exportCsv} className="simple-button secondary" style={{ fontSize: 13, padding: "8px 16px", borderRadius: 10 }}>Export CSV</button>}
        {running
          ? <button onClick={() => { abortRef.current = true; }} style={{ padding: "8px 18px", background: "#fff5f5", border: "1px solid #f5c6c6", borderRadius: 10, color: "#c0392b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Stop</button>
          : <button onClick={run} disabled={idsToRun.length === 0 || disabled} className="simple-button" style={{ fontSize: 13, padding: "8px 20px", borderRadius: 10, opacity: idsToRun.length === 0 || disabled ? 0.45 : 1, cursor: idsToRun.length === 0 || disabled ? "not-allowed" : "pointer" }}>Run Migration →</button>
        }
      </div>

      {error && <div style={{ marginTop: 12, padding: "10px 14px", background: "#fdf2f2", border: "1px solid #f5c6c6", borderRadius: 8, color: "#c0392b", fontSize: 13 }}>{error}</div>}
      {running && progress.total > 0 && <div style={{ marginTop: 16 }}><ProgressBar done={progress.done} total={progress.total} /></div>}
      <ResultsTable results={results} />
    </div>
  );
}

function InstanceBar({ session, onConnect, onDisconnect }: { session: SessionState | null; onConnect: (id: string) => Promise<void>; onDisconnect: () => void }) {
  const [instances, setInstances] = useState<TapClicksInstance[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instances").then((r) => r.json()).then((data) => {
      if (data.instances) { setInstances(data.instances); setSelected(data.instances[0]?.id ?? ""); }
      else setError(data.error ?? "Failed to load instances.");
    }).catch(() => setError("Could not fetch instance list."));
  }, []);

  async function connect() {
    if (!selected) return;
    setLoading(true); setError(null);
    await onConnect(selected);
    setLoading(false);
  }

  const sessionAge = session ? Math.round((Date.now() - session.loggedInAt) / 60000) : 0;
  const sessionWarning = session && Date.now() - session.loggedInAt > SESSION_TTL_MS * 0.75;

  return (
    <div style={{ background: "#ffffff", border: "1px solid #d8e1ec", borderRadius: 18, padding: "20px 28px", marginBottom: 28, boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#18212b", marginBottom: 2 }}>TapClicks Instance</div>
          <div style={{ fontSize: 12, color: "#627286" }}>Select an instance to authenticate and begin migration.</div>
        </div>

        {session ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: sessionWarning ? "#f59e0b" : "#22c55e", display: "inline-block" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#18212b" }}>{instances.find((i) => i.id === session.instanceId)?.label ?? session.instanceId}</span>
              <span style={{ fontSize: 12, color: "#8fa3b8" }}>· {sessionWarning ? "⚠ session aging" : `active ${sessionAge}m ago`}</span>
            </div>
            <button onClick={onDisconnect} className="simple-button secondary" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>Switch Instance</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loading || instances.length === 0}
              style={{ padding: "8px 12px", border: "1px solid #d8e1ec", borderRadius: 10, fontSize: 13, color: "#18212b", background: "#f5f7fb", outline: "none", minWidth: 220 }}>
              {instances.length === 0 && <option value="">Loading…</option>}
              {instances.map((inst) => <option key={inst.id} value={inst.id}>{inst.label} — {inst.url}</option>)}
            </select>
            <button onClick={connect} disabled={loading || !selected} className="simple-button" style={{ fontSize: 13, padding: "8px 20px", borderRadius: 10, opacity: loading || !selected ? 0.65 : 1, cursor: loading || !selected ? "not-allowed" : "pointer" }}>
              {loading ? "Connecting…" : "Connect →"}
            </button>
          </div>
        )}
      </div>
      {error && <div style={{ marginTop: 12, padding: "10px 14px", background: "#fdf2f2", border: "1px solid #f5c6c6", borderRadius: 8, color: "#c0392b", fontSize: 13 }}>{error}</div>}
    </div>
  );
}

export default function MigrationPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const connect = useCallback(async (instanceId: string) => {
    setAuthError(null);
    const res = await fetch("/api/auth/tapclicks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instanceId }) });
    const data = await res.json();
    if (!res.ok || data.error) { setAuthError(data.error ?? "Authentication failed."); return; }
    setSession({ instanceId, instanceUrl: data.instanceUrl, cookie: data.cookie, loggedInAt: Date.now() });
  }, []);

  const disconnect = useCallback(() => setSession(null), []);

  return (
    <div className="estimator-shell">
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#18212b" }}>
            Migration <span style={{ color: "#2f6fed" }}>Console</span>
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: "#627286", lineHeight: 1.6, maxWidth: 560 }}>
            Select an instance, authenticate, then paste IDs to run migrations. Credentials are stored server-side only.
          </p>
        </div>

        <InstanceBar session={session} onConnect={connect} onDisconnect={disconnect} />

        {authError && (
          <div style={{ marginBottom: 20, padding: "12px 16px", background: "#fdf2f2", border: "1px solid #f5c6c6", borderRadius: 10, color: "#c0392b", fontSize: 13 }}>
            <strong>Authentication failed:</strong> {authError}
          </div>
        )}

        {SECTIONS.map((section) => (
          <MigrationPanel key={section.key} section={section} session={session} onSessionExpired={disconnect} />
        ))}
      </div>
    </div>
  );
}
