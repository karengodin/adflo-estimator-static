"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

type Phase = {
  id: string;
  project_id: string;
  phase_name: string;
  phase_order: number;
  status: string;
  planned_start: string | null;
  actual_start: string | null;
  planned_end: string | null;
  actual_end: string | null;
};

type Milestone = {
  id: string;
  project_id: string;
  name: string;
  phase: string;
  due_date: string | null;
  completed_at: string | null;
  signed_off_by: string | null;
  notes: string | null;
};

type HoursSummary = {
  id: string;
  project_id: string;
  phase_id: string;
  category: string;
  estimated_hours: number;
  actual_hours: number;
  notes: string | null;
};

type Project = {
  id: string;
  session_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  implementation_phases: Phase[];
  project_milestones: Milestone[];
  hours_summary: HoursSummary[];
};

type EstimateVersion = {
  id: string;
  version_number: number;
  total_hours: number;
  tier: string | null;
  hours_by_category: Record<string, number> | null;
  reason_for_change: string | null;
  is_current: boolean;
  created_at: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────

const PROJECT_STATUSES = ["planning", "active", "uat", "golive", "closed"] as const;
const STATUS_LABELS: Record<string, string> = {
  planning: "Planning", active: "Active", uat: "UAT", golive: "Go-Live", closed: "Closed",
};
const PHASE_LABELS: Record<string, string> = {
  discovery: "Discovery & Planning",
  pilot:     "Pilot Configuration",
  uat:       "Full UAT Configuration",
  golive:    "Production Go-Live",
};

// ─── Main component ─────────────────────────────────────────────────────────

export default function ProjectTab({
  sessionId,
  estimatedHours,
}: {
  sessionId: string;
  estimatedHours: number;
}) {
  const [project, setProject] = useState<Project | null | undefined>(undefined); // undefined = loading
  const [versions, setVersions] = useState<EstimateVersion[]>([]);
  const [varianceRows, setVarianceRows] = useState<{ category: string; estimated_hours: number; actual_hours: number }[]>([]);
  const [creating, setCreating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [showVersionForm, setShowVersionForm] = useState(false);
  const [newVersionReason, setNewVersionReason] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const [localHours, setLocalHours] = useState<Record<string, string>>({});
  const autoRecalcDone = useRef(false);

  const loadData = useCallback(async () => {
    const [projRes, versRes] = await Promise.all([
      fetch(`/api/estimator/projects?sessionId=${sessionId}`),
      fetch(`/api/estimator/estimate-versions?sessionId=${sessionId}`),
    ]);
    const proj = await projRes.json();
    const vers = await versRes.json();
    setProject(proj); // null if no project
    setVersions(Array.isArray(vers) ? vers : []);

    if (proj?.id) {
      const varRes = await fetch(`/api/estimator/projects/${proj.id}/variance`);
      if (varRes.ok) setVarianceRows(await varRes.json());
    }
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  const recalculate = useCallback(async () => {
    if (!project) return;
    setRecalculating(true);
    const res = await fetch(`/api/estimator/projects/${project.id}/recalculate`, { method: "PATCH" });
    if (res.ok) {
      const updatedSummary: HoursSummary[] = await res.json();
      setProject((p) => p ? { ...p, hours_summary: updatedSummary } : p);
      const varRes = await fetch(`/api/estimator/projects/${project.id}/variance`);
      if (varRes.ok) setVarianceRows(await varRes.json());
    }
    setRecalculating(false);
  }, [project]);

  // Auto-recalculate once if all estimated hours are 0 on first load
  useEffect(() => {
    if (!project || autoRecalcDone.current) return;
    const allZero = project.hours_summary.length > 0 &&
                    project.hours_summary.every((h) => h.estimated_hours === 0);
    if (allZero) {
      autoRecalcDone.current = true;
      recalculate();
    }
  }, [project, recalculate]);

  // Sync local hours state when project loads
  useEffect(() => {
    if (!project) return;
    const init: Record<string, string> = {};
    for (const h of project.hours_summary) init[h.id] = String(h.actual_hours);
    setLocalHours(init);
  }, [project]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function startProject() {
    setCreating(true);
    const res = await fetch("/api/estimator/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) await loadData();
    setCreating(false);
  }

  async function updateProjectStatus(status: string) {
    if (!project) return;
    await fetch(`/api/estimator/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setProject((p) => (p ? { ...p, status } : p));
  }

  async function updatePhase(phaseId: string, patch: Partial<Phase>) {
    if (!project) return;
    const res = await fetch(`/api/estimator/projects/${project.id}/phases/${phaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated: Phase = await res.json();
      setProject((p) =>
        p ? { ...p, implementation_phases: p.implementation_phases.map((ph) => (ph.id === phaseId ? updated : ph)) } : p
      );
    }
  }

  async function toggleMilestone(m: Milestone) {
    if (!project) return;
    const patch = m.completed_at
      ? { completed_at: null, signed_off_by: null }
      : { completed_at: new Date().toISOString(), signed_off_by: null };
    await fetch(`/api/estimator/projects/${project.id}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setProject((p) =>
      p ? { ...p, project_milestones: p.project_milestones.map((x) => (x.id === m.id ? { ...x, ...patch } : x)) } : p
    );
  }

  async function setMilestoneSignOff(m: Milestone, signedOffBy: string) {
    if (!project) return;
    await fetch(`/api/estimator/projects/${project.id}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signed_off_by: signedOffBy }),
    });
    setProject((p) =>
      p ? { ...p, project_milestones: p.project_milestones.map((x) => (x.id === m.id ? { ...x, signed_off_by: signedOffBy } : x)) } : p
    );
  }

  async function saveActualHours(summaryId: string) {
    if (!project) return;
    const actual = Math.max(0, parseFloat(localHours[summaryId] ?? "0") || 0);
    await fetch(`/api/estimator/projects/${project.id}/hours/${summaryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual_hours: actual }),
    });
    setProject((p) =>
      p ? { ...p, hours_summary: p.hours_summary.map((h) => (h.id === summaryId ? { ...h, actual_hours: actual } : h)) } : p
    );
  }

  async function saveNewVersion() {
    setSavingVersion(true);
    await fetch("/api/estimator/estimate-versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, reason: newVersionReason.trim() || undefined }),
    });
    setShowVersionForm(false);
    setNewVersionReason("");
    await loadData();
    setSavingVersion(false);
  }

  // ── Render guards ───────────────────────────────────────────────────────────

  if (project === undefined) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={spinnerStyle} />
        <div style={{ marginTop: 12, color: "#8a9bb0", fontSize: 14 }}>Loading project…</div>
      </div>
    );
  }

  if (project === null) {
    return (
      <div style={{ padding: "56px 0", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>🏗️</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f1623", marginBottom: 8 }}>No project started</div>
        <div style={{ fontSize: 14, color: "#627286", marginBottom: 28, maxWidth: 400, margin: "0 auto 28px" }}>
          Start a project to track phases, hours, milestones, and estimate versions for this implementation.
        </div>
        <button
          type="button"
          onClick={startProject}
          disabled={creating}
          style={{
            padding: "12px 28px", borderRadius: 12, border: "none",
            background: creating ? "#b0c4e8" : "#2f6fed", color: "#fff",
            fontWeight: 700, fontSize: 15, cursor: creating ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}
        >
          {creating ? "Starting…" : "Start Project →"}
        </button>
      </div>
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const sortedPhases = [...project.implementation_phases].sort((a, b) => a.phase_order - b.phase_order);
  const hoursByPhase: Record<string, HoursSummary[]> = {};
  for (const h of project.hours_summary) {
    if (!hoursByPhase[h.phase_id]) hoursByPhase[h.phase_id] = [];
    hoursByPhase[h.phase_id].push(h);
  }

  // Variance report data: aggregated from dedicated server-side query
  const allCats = varianceRows.map((r) => r.category);
  const catEst: Record<string, number> = Object.fromEntries(varianceRows.map((r) => [r.category, r.estimated_hours]));
  const catAct: Record<string, number> = Object.fromEntries(varianceRows.map((r) => [r.category, r.actual_hours]));
  const totalEst = varianceRows.reduce((s, r) => s + r.estimated_hours, 0) || estimatedHours;
  const totalAct = varianceRows.reduce((s, r) => s + r.actual_hours, 0);
  const overallVariance = totalEst - totalAct;

  // Answers-changed banner: compare current estimatedHours with latest version
  const latestVersion = versions.find((v) => v.is_current) ?? versions[versions.length - 1];
  const estimateChanged = latestVersion && Math.round(latestVersion.total_hours) !== Math.round(estimatedHours);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Answers-changed banner */}
      {estimateChanged && (project.status === "active" || project.status === "uat") && (
        <div style={{ background: "#fff8e8", border: "1px solid #f3e0a3", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#8a6417" }}>Estimate has changed since the last version snapshot.</span>
            <span style={{ fontSize: 13, color: "#8a6417", marginLeft: 8 }}>
              Current: {estimatedHours} hrs · Last version: {latestVersion?.total_hours} hrs
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowVersionForm(true)}
            style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #f3e0a3", background: "#fff", color: "#8a6417", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            Save New Version →
          </button>
        </div>
      )}

      {/* ── A: PROJECT OVERVIEW ── */}
      <SectionCard title="Project Overview">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
          <span style={projectStatusBadgeStyle(project.status)}>
            ● {STATUS_LABELS[project.status] ?? project.status}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PROJECT_STATUSES.filter((s) => s !== project.status).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => updateProjectStatus(s)}
                style={{
                  ...smallBtnStyle,
                  ...(s === "closed" ? { color: "#c94b4b", borderColor: "#f9c0c0" } : {}),
                }}
              >
                {s === "closed" ? "Close" : `→ ${STATUS_LABELS[s]}`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <OverviewStat label="Estimated Hours" value={`${totalEst}`} sub="hrs" />
          <OverviewStat label="Actual Hours" value={`${totalAct}`} sub="hrs" />
          <OverviewStat
            label="Variance"
            value={`${overallVariance >= 0 ? "+" : ""}${overallVariance}`}
            sub="hrs"
            accent={overallVariance >= 0 ? "#1f9d55" : "#c94b4b"}
          />
        </div>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={recalculate}
            disabled={recalculating}
            style={{
              ...smallBtnStyle,
              display: "flex", alignItems: "center", gap: 6,
              opacity: recalculating ? 0.6 : 1,
            }}
          >
            {recalculating
              ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #b0bfcc", borderTopColor: "#2f6fed", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Recalculating…</>
              : "↻ Recalculate Estimated Hours"}
          </button>
        </div>

        {/* Phase timeline */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0", marginBottom: 10 }}>Timeline</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {sortedPhases.map((ph) => (
              <div key={ph.id} style={{ background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8a9bb0", marginBottom: 4 }}>{PHASE_LABELS[ph.phase_name]}</div>
                <div style={{ marginBottom: 4 }}><span style={phaseStatusDot(ph.status)} /></div>
                {ph.planned_start
                  ? <div style={{ fontSize: 11, color: "#627286" }}>{fmtDate(ph.planned_start)} → {ph.planned_end ? fmtDate(ph.planned_end) : "TBD"}</div>
                  : <div style={{ fontSize: 11, color: "#aab4c0" }}>Dates not set</div>
                }
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── B: ESTIMATE VERSIONS ── */}
      <SectionCard title="Estimate Versions">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <button type="button" onClick={() => setShowVersionForm(!showVersionForm)} style={outlineBtnStyle}>
            {showVersionForm ? "Cancel" : "+ New Version"}
          </button>
        </div>

        {showVersionForm && (
          <div style={{ background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0", marginBottom: 6 }}>Reason for Change</div>
            <input
              value={newVersionReason}
              onChange={(e) => setNewVersionReason(e.target.value)}
              placeholder="e.g. Client added 3 products after discovery call"
              style={inputStyle}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={saveNewVersion}
                disabled={savingVersion}
                style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "#2f6fed", color: "#fff", fontWeight: 600, fontSize: 13, cursor: savingVersion ? "not-allowed" : "pointer", fontFamily: "inherit" }}
              >
                {savingVersion ? "Saving…" : "Save Version"}
              </button>
            </div>
          </div>
        )}

        {versions.length === 0 ? (
          <div style={{ color: "#8a9bb0", fontSize: 14, padding: "12px 0" }}>No estimate versions yet. Create one to begin tracking changes.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Version", "Date", "Hours", "Tier", "Reason", "Δ Hours"].map((h) => (
                    <th key={h} style={vThStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => {
                  const prev = versions[i - 1];
                  const delta = prev != null ? v.total_hours - prev.total_hours : null;
                  return (
                    <tr key={v.id} style={{ background: v.is_current ? "#f0f7ff" : undefined }}>
                      <td style={vTdStyle}>
                        <span style={{ fontWeight: 700 }}>v{v.version_number}</span>
                        {v.is_current && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: "#eaf1ff", color: "#2f6fed", padding: "2px 7px", borderRadius: 999, border: "1px solid #cddcff" }}>
                            Current
                          </span>
                        )}
                      </td>
                      <td style={vTdStyle}>{fmtDatetime(v.created_at)}</td>
                      <td style={{ ...vTdStyle, fontVariantNumeric: "tabular-nums" }}>{v.total_hours}</td>
                      <td style={vTdStyle}>{v.tier ?? "—"}</td>
                      <td style={{ ...vTdStyle, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.reason_for_change || "—"}</td>
                      <td style={{ ...vTdStyle, color: delta === null ? "#8a9bb0" : delta > 0 ? "#c94b4b" : delta < 0 ? "#1f9d55" : "#627286", fontVariantNumeric: "tabular-nums" }}>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── C: PHASES & HOURS ── */}
      <SectionCard title="Phases & Hours">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {sortedPhases.map((phase) => {
            const phaseHours = hoursByPhase[phase.id] ?? [];
            const phaseMilestones = project.project_milestones.filter((m) => m.phase === phase.phase_name);
            const phaseEst = phaseHours.reduce((s, h) => s + h.estimated_hours, 0);
            const phaseAct = phaseHours.reduce((s, h) => s + h.actual_hours, 0);

            return (
              <div key={phase.id} style={{ border: "1px solid #dde5ef", borderRadius: 16, overflow: "hidden" }}>
                {/* Phase header */}
                <div style={{ background: "#f8fafc", padding: "13px 18px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#0f1623" }}>{PHASE_LABELS[phase.phase_name]}</span>
                    <span style={phaseStatusBadge(phase.status)}>{phase.status.replace("_", " ")}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {phase.status === "not_started" && (
                      <button type="button" onClick={() => updatePhase(phase.id, { status: "in_progress", actual_start: today() })} style={smallBtnStyle}>
                        Start
                      </button>
                    )}
                    {phase.status === "in_progress" && (
                      <button
                        type="button"
                        onClick={() => updatePhase(phase.id, { status: "complete", actual_end: today() })}
                        style={{ ...smallBtnStyle, background: "#edf8f2", color: "#1f9d55", borderColor: "#c0e8d0" }}
                      >
                        ✓ Mark Complete
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ padding: "16px 18px" }}>
                  {/* Pilot note */}
                  {phase.phase_name === "pilot" && (
                    <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#f0f7ff", border: "1px solid #cddcff", fontSize: 12.5, color: "#2f6fed" }}>
                      💡 By default, pilot covers 1 product end-to-end. Adjust scope in notes if different.
                    </div>
                  )}
                  {/* Dates */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <DateField label="Planned Start" value={phase.planned_start ?? ""} onCommit={(v) => updatePhase(phase.id, { planned_start: v || null })} />
                    <DateField label="Planned End"   value={phase.planned_end   ?? ""} onCommit={(v) => updatePhase(phase.id, { planned_end:   v || null })} />
                    <DateField label="Actual Start"  value={phase.actual_start  ?? ""} onCommit={(v) => updatePhase(phase.id, { actual_start:  v || null })} />
                    <DateField label="Actual End"    value={phase.actual_end    ?? ""} onCommit={(v) => updatePhase(phase.id, { actual_end:    v || null })} />
                  </div>

                  {/* Hours table */}
                  {phaseHours.length > 0 && (
                    <div style={{ marginBottom: phaseMilestones.length > 0 ? 16 : 0 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={hThStyle}>Category</th>
                            <th style={{ ...hThStyle, textAlign: "right" }}>Estimated</th>
                            <th style={{ ...hThStyle, textAlign: "right" }}>Actual</th>
                            <th style={{ ...hThStyle, textAlign: "right" }}>Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {phaseHours.map((h, idx) => {
                            const localVal = parseFloat(localHours[h.id] ?? String(h.actual_hours)) || 0;
                            const variance = h.estimated_hours - localVal;
                            const isLast = idx === phaseHours.length - 1;
                            return (
                              <tr key={h.id}>
                                <td style={{ ...hTdStyle, borderBottom: isLast ? "none" : "1px solid #f0f4f8" }}>{h.category}</td>
                                <td style={{ ...hTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", fontVariantNumeric: "tabular-nums" }}>{h.estimated_hours}</td>
                                <td style={{ ...hTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", padding: "5px 8px" }}>
                                  <input
                                    type="number"
                                    min={0}
                                    value={localHours[h.id] ?? ""}
                                    onChange={(e) => setLocalHours((prev) => ({ ...prev, [h.id]: e.target.value }))}
                                    onBlur={() => saveActualHours(h.id)}
                                    style={{ width: 64, padding: "5px 8px", borderRadius: 8, border: "1px solid #dde5ef", textAlign: "right", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                                  />
                                </td>
                                <td style={{ ...hTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", color: variance > 0 ? "#1f9d55" : variance < 0 ? "#c94b4b" : "#627286", fontVariantNumeric: "tabular-nums" }}>
                                  {variance > 0 ? "+" : ""}{variance}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#f8fafc" }}>
                            <td style={{ ...hTdStyle, fontWeight: 700, color: "#0f1623" }}>Total</td>
                            <td style={{ ...hTdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{phaseEst}</td>
                            <td style={{ ...hTdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{phaseAct}</td>
                            <td style={{ ...hTdStyle, textAlign: "right", fontWeight: 700, color: (phaseEst - phaseAct) >= 0 ? "#1f9d55" : "#c94b4b", fontVariantNumeric: "tabular-nums" }}>
                              {phaseEst - phaseAct > 0 ? "+" : ""}{phaseEst - phaseAct}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Milestones */}
                  {phaseMilestones.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0", marginBottom: 8 }}>Milestones</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {phaseMilestones.map((m) => (
                          <MilestoneRow
                            key={m.id}
                            milestone={m}
                            onToggle={() => toggleMilestone(m)}
                            onSignOff={(name) => setMilestoneSignOff(m, name)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── D: VARIANCE REPORT ── */}
      <SectionCard title="Variance Report">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={vThStyle}>Category</th>
                <th style={{ ...vThStyle, textAlign: "right" }}>Est. Hours</th>
                <th style={{ ...vThStyle, textAlign: "right" }}>Actual Hours</th>
                <th style={{ ...vThStyle, textAlign: "right" }}>Variance</th>
                <th style={{ ...vThStyle, textAlign: "right" }}>%</th>
              </tr>
            </thead>
            <tbody>
              {allCats.map((cat, i) => {
                const est = catEst[cat] ?? 0;
                const act = catAct[cat] ?? 0;
                const v = est - act;
                const pct = est > 0 ? Math.round((v / est) * 100) : 0;
                const isLast = i === allCats.length - 1;
                return (
                  <tr key={cat}>
                    <td style={{ ...vTdStyle, borderBottom: isLast ? "none" : "1px solid #f0f4f8" }}>{cat}</td>
                    <td style={{ ...vTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", fontVariantNumeric: "tabular-nums" }}>{est}</td>
                    <td style={{ ...vTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", fontVariantNumeric: "tabular-nums" }}>{act}</td>
                    <td style={{ ...vTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", color: v >= 0 ? "#1f9d55" : "#c94b4b", fontVariantNumeric: "tabular-nums" }}>
                      {v > 0 ? "+" : ""}{v}
                    </td>
                    <td style={{ ...vTdStyle, textAlign: "right", borderBottom: isLast ? "none" : "1px solid #f0f4f8", color: pct >= 0 ? "#1f9d55" : "#c94b4b" }}>
                      {pct > 0 ? "+" : ""}{pct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f8fafc" }}>
                <td style={{ ...vTdStyle, fontWeight: 800, color: "#0f1623" }}>Total</td>
                <td style={{ ...vTdStyle, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{totalEst}</td>
                <td style={{ ...vTdStyle, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{totalAct}</td>
                <td style={{ ...vTdStyle, textAlign: "right", fontWeight: 800, color: overallVariance >= 0 ? "#1f9d55" : "#c94b4b", fontVariantNumeric: "tabular-nums" }}>
                  {overallVariance > 0 ? "+" : ""}{overallVariance}
                </td>
                <td style={{ ...vTdStyle, textAlign: "right", fontWeight: 800, color: overallVariance >= 0 ? "#1f9d55" : "#c94b4b" }}>
                  {totalEst > 0 ? `${Math.round((overallVariance / totalEst) * 100) > 0 ? "+" : ""}${Math.round((overallVariance / totalEst) * 100)}%` : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{
          marginTop: 16,
          padding: "13px 18px",
          borderRadius: 12,
          background: overallVariance >= 0 ? "#edf8f2" : "#fff0f0",
          border: `1px solid ${overallVariance >= 0 ? "#c0e8d0" : "#f9c0c0"}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: overallVariance >= 0 ? "#1f9d55" : "#c94b4b" }}>
            {overallVariance >= 0
              ? `✓ ${overallVariance} hours under estimate`
              : `⚠ ${Math.abs(overallVariance)} hours over estimate`}
          </span>
          {totalAct > 0 && (
            <span style={{ fontSize: 13, color: "#627286" }}>
              {totalAct} of {totalEst} hours logged
            </span>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.04)" }}>
      <div style={{ padding: "14px 22px", borderBottom: "1px solid #edf2f7", background: "#f8fafc" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>{title}</span>
      </div>
      <div style={{ padding: "20px 22px" }}>{children}</div>
    </div>
  );
}

function OverviewStat({ label, value, sub, accent = "#2f6fed" }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #dde5ef", borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function DateField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8a9bb0" }}>{label}</label>
      <input
        type="date"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onCommit(local); }}
        style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #dde5ef", fontSize: 12.5, fontFamily: "inherit", outline: "none", color: "#18212b" }}
      />
    </div>
  );
}

function MilestoneRow({
  milestone,
  onToggle,
  onSignOff,
}: {
  milestone: Milestone;
  onToggle: () => void;
  onSignOff: (name: string) => void;
}) {
  const [signOff, setSignOff] = useState(milestone.signed_off_by ?? "");
  const done = !!milestone.completed_at;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: done ? "#edf8f2" : "#f8fafc", border: `1px solid ${done ? "#c0e8d0" : "#dde5ef"}` }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: 20, height: 20, borderRadius: 6, border: `2px solid ${done ? "#1f9d55" : "#b0bfcc"}`,
          background: done ? "#1f9d55" : "transparent", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", flexShrink: 0, fontSize: 12, fontWeight: 700,
        }}
      >
        {done ? "✓" : ""}
      </button>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: done ? "#1f9d55" : "#0f1623", textDecoration: done ? "line-through" : undefined }}>
          {milestone.name}
        </span>
        {milestone.due_date && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#8a9bb0" }}>Due {fmtDate(milestone.due_date)}</span>
        )}
      </div>
      {done && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#8a9bb0" }}>Signed off by:</span>
          <input
            value={signOff}
            onChange={(e) => setSignOff(e.target.value)}
            onBlur={() => { if (signOff !== (milestone.signed_off_by ?? "")) onSignOff(signOff); }}
            placeholder="Name"
            style={{ width: 120, padding: "4px 8px", borderRadius: 7, border: "1px solid #c0e8d0", fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Style helpers ─────────────────────────────────────────────────────────

function projectStatusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700 };
  if (status === "active")  return { ...base, background: "#edf8f2", color: "#1f9d55",  border: "1px solid #c0e8d0" };
  if (status === "uat")     return { ...base, background: "#fff7db", color: "#9a6b00",  border: "1px solid #f1dd8c" };
  if (status === "golive")  return { ...base, background: "#eaf1ff", color: "#2f6fed",  border: "1px solid #cddcff" };
  if (status === "closed")  return { ...base, background: "#f1f5f9", color: "#475569",  border: "1px solid #dbe3ec" };
  return { ...base, background: "#f8fafc", color: "#627286", border: "1px solid #dde5ef" };
}

function phaseStatusBadge(status: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "capitalize" };
  if (status === "in_progress") return { ...base, background: "#fff7db", color: "#9a6b00",  border: "1px solid #f1dd8c" };
  if (status === "complete")    return { ...base, background: "#edf8f2", color: "#1f9d55",  border: "1px solid #c0e8d0" };
  return { ...base, background: "#f1f5f9", color: "#8a9bb0", border: "1px solid #dde5ef" };
}

function phaseStatusDot(status: string): React.CSSProperties {
  const color = status === "complete" ? "#1f9d55" : status === "in_progress" ? "#f3a800" : "#b0bfcc";
  return { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color };
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDatetime(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Shared styles ─────────────────────────────────────────────────────────

const vThStyle: React.CSSProperties = {
  textAlign: "left", padding: "9px 14px", fontSize: 10.5,
  textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a9bb0",
  fontWeight: 700, borderBottom: "1px solid #dde5ef", whiteSpace: "nowrap",
};
const vTdStyle: React.CSSProperties = { padding: "11px 14px", color: "#455468", verticalAlign: "middle" };
const hThStyle: React.CSSProperties = { ...vThStyle, padding: "7px 12px" };
const hTdStyle: React.CSSProperties = { padding: "8px 12px", color: "#455468", verticalAlign: "middle" };

const smallBtnStyle: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 8, border: "1px solid #dde5ef",
  background: "#f8fafc", color: "#455468", fontWeight: 600, fontSize: 12,
  cursor: "pointer", fontFamily: "inherit",
};
const outlineBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 10, border: "1px solid #dde5ef",
  background: "#ffffff", color: "#455468", fontWeight: 600, fontSize: 13.5,
  cursor: "pointer", fontFamily: "inherit",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #dde5ef",
  fontSize: 14, fontFamily: "inherit", outline: "none", color: "#18212b",
  boxSizing: "border-box",
};
const spinnerStyle: React.CSSProperties = {
  width: 28, height: 28, border: "3px solid #dde5ef", borderTopColor: "#2f6fed",
  borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto",
};
