"use client";

import { useEffect, useRef, useState } from "react";
import { type AppRole, useRole } from "../../lib/hooks/useRole";
import { supabase } from "../../lib/supabase";

type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  role: AppRole | null;
};

type AuditEntry = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  metadata: Record<string, unknown>;
  source: "app" | "auth";
};

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin",          label: "Admin" },
  { value: "implementation", label: "Implementation" },
  { value: "sales",          label: "Sales" },
];

function roleLabel(r: AppRole | null) {
  return ROLE_OPTIONS.find((o) => o.value === r)?.label ?? "—";
}

function roleBadge(r: AppRole | null) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    admin:          { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
    implementation: { bg: "#eaf1ff", color: "#2f6fed", border: "#cddcff" },
    sales:          { bg: "#edf8f2", color: "#1f9d55", border: "#cfe7d7" },
  };
  const s = r ? (colors[r] ?? colors.implementation) : { bg: "#f0f4f9", color: "#627286", border: "#d8e1ec" };
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {roleLabel(r)}
    </span>
  );
}

const EVENT_COLORS: Record<string, { bg: string; color: string }> = {
  session_created:    { bg: "#eaf1ff", color: "#2f6fed" },
  srd_generated:      { bg: "#f3e8ff", color: "#7c3aed" },
  interview_completed:{ bg: "#edf8f2", color: "#1f9d55" },
  extraction_run:     { bg: "#fff7ed", color: "#c2410c" },
  role_changed:       { bg: "#fef2f2", color: "#dc2626" },
  login:              { bg: "#e0f2fe", color: "#0369a1" },
  logout:             { bg: "#f1f5f9", color: "#64748b" },
  token_refreshed:    { bg: "#f8fafc", color: "#94a3b8" },
  user_signedup:      { bg: "#edf8f2", color: "#1f9d55" },
};

function eventBadge(eventType: string) {
  const s = EVENT_COLORS[eventType] ?? { bg: "#f0f4f9", color: "#627286" };
  const label = eventType.replace(/_/g, " ");
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid #d8e1ec",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  color: "#0f1623",
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg, #2f6fed, #1a4fb5)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  borderRadius: 8,
  border: "1px solid #d8e1ec",
  background: "#fff",
  color: "#455468",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

// ── Inline field with save ────────────────────────────────────────────────────

function EditField({
  label,
  value,
  type = "text",
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onSave: (v: string) => Promise<string | null>;
}) {
  const [draft, setDraft]   = useState(value);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState("");
  const [err, setErr]       = useState("");

  useEffect(() => { setDraft(value); }, [value]);

  async function save() {
    if (draft === value) return;
    setSaving(true); setMsg(""); setErr("");
    const e = await onSave(draft);
    setSaving(false);
    if (e) setErr(e); else { setMsg("Saved"); setTimeout(() => setMsg(""), 2500); }
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={placeholder} style={{ ...inputStyle, maxWidth: 300 }} />
        <button onClick={save} disabled={saving || draft === value} style={{ ...saveBtnStyle, opacity: saving || draft === value ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span style={{ fontSize: 12, color: "#1f9d55", fontWeight: 600 }}>✓ {msg}</span>}
        {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
      </div>
    </div>
  );
}

// ── Password reset block ──────────────────────────────────────────────────────

function PasswordBlock({ label, onSave }: { label: string; onSave: (pw: string) => Promise<string | null> }) {
  const [open, setOpen]       = useState(false);
  const [pw, setPw]           = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState("");
  const [err, setErr]         = useState("");

  async function save() {
    if (!pw) return;
    if (pw !== confirm) { setErr("Passwords do not match."); return; }
    if (pw.length < 6)  { setErr("Minimum 6 characters."); return; }
    setSaving(true); setErr(""); setMsg("");
    const e = await onSave(pw);
    setSaving(false);
    if (e) { setErr(e); } else {
      setMsg("Password updated."); setPw(""); setConfirm("");
      setTimeout(() => { setOpen(false); setMsg(""); }, 2500);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
      {!open ? (
        <button onClick={() => setOpen(true)} style={ghostBtnStyle}>Set password…</button>
      ) : (
        <div style={{ display: "grid", gap: 8, maxWidth: 300 }}>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" autoFocus style={inputStyle} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Confirm password" style={inputStyle} />
          {err && <div style={{ fontSize: 12, color: "#dc2626" }}>{err}</div>}
          {msg && <div style={{ fontSize: 12, color: "#1f9d55", fontWeight: 600 }}>✓ {msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving} style={saveBtnStyle}>{saving ? "Saving…" : "Update password"}</button>
            <button onClick={() => { setOpen(false); setPw(""); setConfirm(""); setErr(""); }} style={ghostBtnStyle}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { isAdmin, isLoading: roleLoading, accessToken, userId } = useRole();

  // Tab
  const [activeTab, setActiveTab] = useState<"users" | "audit">("users");

  // Users tab state
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(true);

  // Panel
  const [panel, setPanel]       = useState<UserRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Add User modal
  const [addOpen, setAddOpen]   = useState(false);
  const [addName, setAddName]   = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole]   = useState<AppRole>("implementation");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEventFilter, setAuditEventFilter] = useState("");
  const [auditUserFilter, setAuditUserFilter]   = useState("");

  const panelRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function fetchUsers(token: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function fetchAudit(token: string) {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/admin/audit", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setAuditEntries(await res.json());
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (roleLoading || !isAdmin || !accessToken) { if (!roleLoading) setLoading(false); return; }
    fetchUsers(accessToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isAdmin, accessToken]);

  useEffect(() => {
    if (activeTab !== "audit" || !accessToken || auditEntries.length > 0) return;
    fetchAudit(accessToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, accessToken]);

  // Auto-open panel from URL param (used by must_change_password banner)
  useEffect(() => {
    if (users.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("user");
    if (targetId) {
      const target = users.find((u) => u.id === targetId);
      if (target) openPanel(target);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  // ── Panel helpers ────────────────────────────────────────────────────────
  function openPanel(user: UserRow) {
    setPanel(user);
    setConfirmRemove(false);
  }

  function closePanel() {
    setPanel(null);
    setConfirmRemove(false);
  }

  function patchLocal(id: string, patch: Partial<UserRow>) {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...patch } : u));
    setPanel((prev) => prev?.id === id ? { ...prev, ...patch } : prev);
  }

  async function adminPatch(id: string, body: Record<string, unknown>): Promise<string | null> {
    if (!accessToken) return "Not authenticated";
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json() as { error: string }; return e.error; }
    return null;
  }

  async function removeUser() {
    if (!panel || !accessToken) return;
    setRemoving(true);
    const res = await fetch(`/api/admin/users/${panel.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) { setUsers((prev) => prev.filter((u) => u.id !== panel.id)); closePanel(); }
    setRemoving(false);
  }

  // ── Add User ────────────────────────────────────────────────────────────
  async function createUser() {
    if (!addEmail.trim() || !addPassword || !accessToken) return;
    setAddSaving(true); setAddError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ display_name: addName.trim(), email: addEmail.trim(), password: addPassword, role: addRole }),
    });
    setAddSaving(false);
    if (!res.ok) { const e = await res.json() as { error: string }; setAddError(e.error); return; }
    setAddOpen(false); setAddName(""); setAddEmail(""); setAddPassword(""); setAddRole("implementation");
    fetchUsers(accessToken);
  }

  // ── Guard ────────────────────────────────────────────────────────────────
  if (roleLoading) return <div style={{ padding: 48, color: "#627286", fontSize: 14 }}>Loading…</div>;
  if (!isAdmin) {
    return (
      <div style={{ padding: 64, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f1623", marginBottom: 8 }}>Access Denied</div>
        <div style={{ fontSize: 14, color: "#627286" }}>You need admin privileges to view this page.</div>
      </div>
    );
  }

  const isOwnRow = (id: string) => id === userId;

  // ── Audit log derived data ───────────────────────────────────────────────
  const auditEventTypes = Array.from(new Set(auditEntries.map((e) => e.event_type))).sort();
  const auditUsers = Array.from(
    new Map(
      auditEntries
        .filter((e) => e.user_email)
        .map((e) => [e.user_email!, e.user_email!])
    ).values()
  ).sort();

  const filteredAudit = auditEntries.filter((e) => {
    if (auditEventFilter && e.event_type !== auditEventFilter) return false;
    if (auditUserFilter && e.user_email !== auditUserFilter) return false;
    return true;
  });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 16px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>Admin</h1>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #dde5ef", paddingBottom: 0 }}>
          {(["users", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "9px 18px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? "#2f6fed" : "#627286",
                borderBottom: activeTab === tab ? "2px solid #2f6fed" : "2px solid transparent",
                marginBottom: -1,
                transition: "color 0.15s",
              }}
            >
              {tab === "users" ? "Users" : "Audit Log"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Users tab ────────────────────────────────────────────────────── */}
      {activeTab === "users" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <p style={{ margin: 0, fontSize: 14, color: "#627286" }}>Click any row to edit. Your own row has additional account options.</p>
            <button
              onClick={() => { setAddOpen(true); setAddError(""); setAddName(""); setAddEmail(""); setAddPassword(""); setAddRole("implementation"); }}
              style={{ padding: "10px 20px", background: "linear-gradient(135deg, #2f6fed, #1a4fb5)", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              + Add User
            </button>
          </div>

          <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>
            {loading ? (
              <div style={{ padding: "52px 24px", textAlign: "center", color: "#8a9bb0", fontSize: 14 }}>Loading users…</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Name", "Email", "Role", "Joined", ""].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 11, color: "#627286", textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #dde5ef" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: "52px 24px", textAlign: "center", color: "#8a9bb0" }}>No users found.</td></tr>
                  ) : (
                    users.map((u, i) => {
                      const isLast = i === users.length - 1;
                      const bd = isLast ? "none" : "1px solid #edf2f7";
                      const mine = isOwnRow(u.id);
                      return (
                        <tr
                          key={u.id}
                          onClick={() => openPanel(u)}
                          style={{ cursor: "pointer", transition: "background 0.1s" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          <td style={{ padding: "14px 16px", borderBottom: bd, fontWeight: 600, color: "#0f1623" }}>
                            {u.display_name || <span style={{ color: "#8a9bb0", fontWeight: 400 }}>—</span>}
                            {mine && <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: "#627286", background: "#f0f4f9", padding: "2px 6px", borderRadius: 4 }}>you</span>}
                          </td>
                          <td style={{ padding: "14px 16px", borderBottom: bd, color: "#627286" }}>{u.email || "—"}</td>
                          <td style={{ padding: "14px 16px", borderBottom: bd }}>{roleBadge(u.role)}</td>
                          <td style={{ padding: "14px 16px", borderBottom: bd, color: "#8a9bb0", fontSize: 12 }}>
                            {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td style={{ padding: "14px 16px", borderBottom: bd, color: "#c8d4e0", fontSize: 13 }}>›</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Audit Log tab ────────────────────────────────────────────────── */}
      {activeTab === "audit" && (
        <>
          {/* Filters + refresh */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <select
              value={auditEventFilter}
              onChange={(e) => setAuditEventFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid #d8e1ec", fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#0f1623", cursor: "pointer" }}
            >
              <option value="">All event types</option>
              {auditEventTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
            <select
              value={auditUserFilter}
              onChange={(e) => setAuditUserFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid #d8e1ec", fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#0f1623", cursor: "pointer" }}
            >
              <option value="">All users</option>
              {auditUsers.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <button
              onClick={() => accessToken && fetchAudit(accessToken)}
              style={{ ...ghostBtnStyle, marginLeft: "auto" }}
            >
              Refresh
            </button>
            {(auditEventFilter || auditUserFilter) && (
              <button
                onClick={() => { setAuditEventFilter(""); setAuditUserFilter(""); }}
                style={{ ...ghostBtnStyle, color: "#8a9bb0" }}
              >
                Clear filters
              </button>
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>
            {auditLoading ? (
              <div style={{ padding: "52px 24px", textAlign: "center", color: "#8a9bb0", fontSize: 14 }}>Loading audit log…</div>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Time", "User", "Event", "Resource", "Details"].map((h) => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 11, color: "#627286", textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #dde5ef" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: "52px 24px", textAlign: "center", color: "#8a9bb0" }}>
                        {auditEntries.length === 0 ? "No events recorded yet." : "No events match the current filters."}
                      </td></tr>
                    ) : (
                      filteredAudit.map((entry, i) => {
                        const isLast = i === filteredAudit.length - 1;
                        const bd = isLast ? "none" : "1px solid #edf2f7";

                        const detailParts: string[] = [];
                        if (entry.resource_type && !entry.resource_name) detailParts.push(entry.resource_type);
                        if (entry.metadata?.new_role) detailParts.push(`→ ${entry.metadata.new_role}`);
                        if (entry.metadata?.extraction_type) detailParts.push(String(entry.metadata.extraction_type).replace(/_/g, " "));
                        if (entry.metadata?.record_count !== undefined) detailParts.push(`${entry.metadata.record_count} records`);
                        if (entry.metadata?.tier) detailParts.push(String(entry.metadata.tier));
                        if (entry.metadata?.estimated_hours) detailParts.push(`${entry.metadata.estimated_hours} hrs`);
                        if (entry.metadata?.ip && entry.source === "auth") detailParts.push(`IP: ${entry.metadata.ip}`);

                        return (
                          <tr key={entry.id} style={{ transition: "background 0.1s" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                          >
                            <td style={{ padding: "12px 16px", borderBottom: bd, color: "#627286", fontSize: 12, whiteSpace: "nowrap" }}>
                              {fmtTime(entry.created_at)}
                              {entry.source === "auth" && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>auth</span>
                              )}
                            </td>
                            <td style={{ padding: "12px 16px", borderBottom: bd, color: "#455468", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {entry.user_email || <span style={{ color: "#c8d4e0" }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px", borderBottom: bd }}>
                              {eventBadge(entry.event_type)}
                            </td>
                            <td style={{ padding: "12px 16px", borderBottom: bd, color: "#0f1623", fontWeight: 500, fontSize: 13 }}>
                              {entry.resource_name || <span style={{ color: "#c8d4e0" }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px", borderBottom: bd, color: "#8a9bb0", fontSize: 12 }}>
                              {detailParts.join(" · ") || "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {filteredAudit.length > 0 && (
                  <div style={{ padding: "10px 16px", borderTop: "1px solid #edf2f7", fontSize: 11, color: "#94a3b8", textAlign: "right" }}>
                    Showing {filteredAudit.length} of {auditEntries.length} events (last 200)
                    {" · "}Login events from Supabase auth log may not be available depending on project configuration.
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── User detail panel (slide-out) ─────────────────────────────────── */}
      {panel && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,22,35,0.35)", zIndex: 200, display: "flex", justifyContent: "flex-end" }}
          onClick={(e) => { if (e.target === e.currentTarget) closePanel(); }}
        >
          <div
            ref={panelRef}
            style={{ width: 460, height: "100%", background: "#fff", boxShadow: "-8px 0 40px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {/* Panel header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #edf2f7", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#0f1623" }}>
                  {panel.display_name || panel.email || "User"}
                  {isOwnRow(panel.id) && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#2f6fed", background: "#eaf1ff", padding: "2px 7px", borderRadius: 4 }}>you</span>}
                </div>
                <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 2 }}>{panel.email}</div>
              </div>
              <button onClick={closePanel} style={{ background: "none", border: "1px solid #d8e1ec", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "#627286", fontSize: 13, fontFamily: "inherit" }}>✕</button>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "grid", gap: 24 }}>

              {/* Identity */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Identity</div>
                <div style={{ display: "grid", gap: 14 }}>
                  <EditField
                    label="Display Name"
                    value={panel.display_name ?? ""}
                    placeholder="Full name"
                    onSave={async (v) => {
                      const e = await adminPatch(panel.id, { display_name: v });
                      if (!e) patchLocal(panel.id, { display_name: v });
                      return e;
                    }}
                  />
                  <EditField
                    label="Email"
                    value={panel.email ?? ""}
                    type="email"
                    placeholder="email@example.com"
                    onSave={async (v) => {
                      const e = await adminPatch(panel.id, { email: v });
                      if (!e) patchLocal(panel.id, { email: v });
                      return e;
                    }}
                  />
                </div>
              </section>

              {/* Access */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Access</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Role</div>
                  {isOwnRow(panel.id) ? (
                    <div>{roleBadge(panel.role)} <span style={{ fontSize: 12, color: "#8a9bb0", marginLeft: 8 }}>You cannot change your own role.</span></div>
                  ) : (
                    <select
                      value={panel.role ?? ""}
                      onChange={async (e) => {
                        const newRole = e.target.value as AppRole;
                        const err = await adminPatch(panel.id, { role: newRole });
                        if (!err) patchLocal(panel.id, { role: newRole });
                      }}
                      style={{ padding: "9px 12px", borderRadius: 9, border: "1px solid #d8e1ec", fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#0f1623", cursor: "pointer", maxWidth: 200 }}
                    >
                      {!panel.role && <option value="">— unassigned —</option>}
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </section>

              {/* Password */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Password</div>
                {isOwnRow(panel.id) ? (
                  <PasswordBlock
                    label="Change my password"
                    onSave={async (pw) => {
                      const { error } = await supabase.auth.updateUser({ password: pw });
                      return error?.message ?? null;
                    }}
                  />
                ) : (
                  <div>
                    <PasswordBlock
                      label="Set temporary password"
                      onSave={async (pw) => adminPatch(panel.id, { password: pw })}
                    />
                    <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 8 }}>
                      User will be prompted to change this on next login.
                    </div>
                  </div>
                )}
              </section>

              {/* Danger zone */}
              {!isOwnRow(panel.id) && (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Danger Zone</div>
                  {confirmRemove ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#627286" }}>Remove {panel.email}?</span>
                      <button
                        onClick={removeUser}
                        disabled={removing}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {removing ? "Removing…" : "Confirm remove"}
                      </button>
                      <button onClick={() => setConfirmRemove(false)} style={ghostBtnStyle}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(true)}
                      style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Remove user…
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add User modal ────────────────────────────────────────────────── */}
      {addOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,22,35,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}
        >
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623", marginBottom: 6 }}>Add User</div>
            <div style={{ fontSize: 13, color: "#627286", marginBottom: 22 }}>
              Account is created immediately. User will be prompted to change their password on first login.
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {[
                { label: "Full Name", value: addName, set: setAddName, type: "text",     placeholder: "Jane Smith" },
                { label: "Email",     value: addEmail, set: setAddEmail, type: "email",  placeholder: "jane@example.com", autoFocus: true },
                { label: "Temporary Password", value: addPassword, set: setAddPassword, type: "password", placeholder: "At least 6 characters" },
              ].map(({ label, value, set, type, placeholder }) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#627286", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</label>
                  <input type={type} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #d8e1ec", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
                </div>
              ))}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#627286", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Role</label>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as AppRole)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #d8e1ec", fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#0f1623", cursor: "pointer" }}>
                  {ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            </div>
            {addError && <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{addError}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setAddOpen(false)} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid #d8e1ec", background: "#fff", color: "#627286", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={createUser} disabled={addSaving || !addEmail.trim() || !addPassword} style={{ padding: "9px 18px", borderRadius: 10, background: "linear-gradient(135deg, #2f6fed, #1a4fb5)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: addSaving || !addEmail.trim() || !addPassword ? 0.6 : 1 }}>
                {addSaving ? "Creating…" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
