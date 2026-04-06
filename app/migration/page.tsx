"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

// ─── Types ─────────────────────────────────────────────────────────────────

type Instance = {
  id: string;
  name: string;
  base_url: string;
  session_cookie: string; // encrypted at rest, placeholder shown in UI
  is_active: boolean;
  cookie_expires_at: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConnectionStatus = "idle" | "testing" | "ok" | "fail";

type ModalMode = "add" | "edit";

type FormState = {
  name: string;
  base_url: string;
  session_cookie: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  base_url: "",
  session_cookie: "",
  is_active: true,
};

// ─── Lovable proxy helper ──────────────────────────────────────────────────

async function callLovable(fn: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/lovable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fn, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({});

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("add");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch instances from AdFlo's own Supabase ──────────────────────────

  const fetchInstances = async () => {
    const { data, error } = await supabase
      .from("instances")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) console.error("Error fetching instances:", error);
    else setInstances((data as Instance[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  // ── Modal helpers ──────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId(null);
    setModalMode("add");
    setModalOpen(true);
  };

  const openEdit = (instance: Instance) => {
    setForm({
      name: instance.name,
      base_url: instance.base_url,
      session_cookie: "", // never pre-fill the cookie
      is_active: instance.is_active,
    });
    setFormError(null);
    setEditingId(instance.id);
    setModalMode("edit");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setFormError(null);
  };

  // ── Save (create or update via Lovable proxy) ──────────────────────────

  const handleSave = async () => {
    setFormError(null);

    if (!form.name.trim()) return setFormError("Name is required.");
    if (!form.base_url.trim()) return setFormError("Base URL is required.");
    try { new URL(form.base_url); } catch { return setFormError("Enter a valid URL (include https://)."); }
    if (modalMode === "add" && !form.session_cookie.trim()) return setFormError("Session cookie is required.");

    try {
      setSaving(true);

      if (modalMode === "add") {
        await callLovable("manage-instance", {
          action: "create",
          name: form.name.trim(),
          base_url: form.base_url.trim(),
          session_cookie: form.session_cookie.trim(),
          is_active: form.is_active,
        });
      } else if (editingId) {
        const payload: Record<string, unknown> = {
          action: "update",
          id: editingId,
          name: form.name.trim(),
          base_url: form.base_url.trim(),
          is_active: form.is_active,
        };
        // Only send cookie if user typed a new one
        if (form.session_cookie.trim()) {
          payload.session_cookie = form.session_cookie.trim();
        }
        await callLovable("manage-instance", payload);
      }

      await fetchInstances();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await callLovable("manage-instance", {
        action: "delete",
        id: deleteTarget.id,
      });
      await fetchInstances();
      setDeleteTarget(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
    }
  };

  // ── Test connection ────────────────────────────────────────────────────

  const handleTest = async (instance: Instance) => {
    setConnectionStatus((prev) => ({ ...prev, [instance.id]: "testing" }));
    try {
      await callLovable("test-connection", { instance_id: instance.id });
      setConnectionStatus((prev) => ({ ...prev, [instance.id]: "ok" }));
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [instance.id]: "fail" }));
    }
  };

  // ── Cookie expiry helpers ──────────────────────────────────────────────

  const getCookieStatus = (instance: Instance) => {
    if (!instance.cookie_expires_at) return null;
    const expires = new Date(instance.cookie_expires_at);
    const now = new Date();
    const diffMs = expires.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: "Expired", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
    if (diffDays <= 3) return { label: `Expires in ${diffDays}d`, color: "#b45309", bg: "#fffbeb", border: "#fde68a" };
    return { label: `Expires ${expires.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, color: "#1f9d55", bg: "#edf8f2", border: "#cfe7d7" };
  };

  const formatDate = (val: string | null) =>
    val ? new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>

      {/* Page header */}
      <div style={{ marginBottom: 28, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f1623" }}>
            adfloMigrate
          </h1>
          <p style={{ marginTop: 6, color: "#627286", fontSize: 14, margin: "6px 0 0" }}>
            Manage TapClicks instances and run migrations between environments.
          </p>
        </div>
        <button type="button" onClick={openAdd} style={primaryButtonStyle}>
          + Add Instance
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginBottom: 24 }}>
        <MiniStat value={String(instances.length)} label="Total Instances" accent="#2f6fed" />
        <MiniStat value={String(instances.filter(i => i.is_active).length)} label="Active" accent="#4fbf9f" />
        <MiniStat
          value={String(instances.filter(i => i.cookie_expires_at && new Date(i.cookie_expires_at) < new Date()).length)}
          label="Expired Cookies"
          accent="#e8974a"
        />
      </div>

      {/* Instances list */}
      <div style={{ background: "#ffffff", border: "1px solid #dde5ef", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 4px rgba(16,24,40,0.05)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #dde5ef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f1623", letterSpacing: "-0.01em" }}>
            Instances
            {instances.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, background: "#eaf1ff", color: "#2f6fed", padding: "2px 8px", borderRadius: 999, border: "1px solid #cddcff" }}>
                {instances.length}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#627286" }}>
            <div style={spinnerStyle} />
            <div style={{ marginTop: 12, fontSize: 14 }}>Loading instances…</div>
          </div>
        ) : instances.length === 0 ? (
          <div style={{ padding: "52px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔌</div>
            <div style={{ fontWeight: 700, color: "#0f1623", marginBottom: 6 }}>No instances yet</div>
            <div style={{ color: "#8a9bb0", fontSize: 14, marginBottom: 20 }}>
              Add a TapClicks instance to get started.
            </div>
            <button type="button" onClick={openAdd} style={primaryButtonStyle}>
              + Add Instance
            </button>
          </div>
        ) : (
          <div>
            {instances.map((instance, i) => {
              const cookieStatus = getCookieStatus(instance);
              const connStatus = connectionStatus[instance.id] || "idle";
              const isLast = i === instances.length - 1;

              return (
                <div
                  key={instance.id}
                  style={{
                    padding: "18px 22px",
                    borderBottom: isLast ? "none" : "1px solid #edf2f7",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    flexWrap: "wrap",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Status dot */}
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: instance.is_active ? "#4fbf9f" : "#d0daea",
                      flexShrink: 0,
                      boxShadow: instance.is_active ? "0 0 0 3px rgba(79,191,159,0.2)" : "none",
                    }}
                  />

                  {/* Name + URL */}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 700, color: "#0f1623", fontSize: 14 }}>
                      {instance.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                      {instance.base_url}
                    </div>
                  </div>

                  {/* Cookie expiry badge */}
                  {cookieStatus && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: cookieStatus.bg,
                      color: cookieStatus.color,
                      border: `1px solid ${cookieStatus.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      {cookieStatus.label}
                    </span>
                  )}

                  {/* Last connected */}
                  <div style={{ fontSize: 12, color: "#8a9bb0", whiteSpace: "nowrap" }}>
                    Last connected: {formatDate(instance.last_connected_at)}
                  </div>

                  {/* Connection test result */}
                  {connStatus !== "idle" && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                      ...(connStatus === "testing"
                        ? { background: "#eaf1ff", color: "#2f6fed", border: "1px solid #cddcff" }
                        : connStatus === "ok"
                        ? { background: "#edf8f2", color: "#1f9d55", border: "1px solid #cfe7d7" }
                        : { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }),
                    }}>
                      {connStatus === "testing" ? "Testing…" : connStatus === "ok" ? "✓ Connected" : "✗ Failed"}
                    </span>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleTest(instance)}
                      disabled={connStatus === "testing"}
                      style={outlineButtonSmallStyle}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(instance)}
                      style={outlineButtonSmallStyle}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(instance)}
                      style={{ ...outlineButtonSmallStyle, color: "#dc2626", borderColor: "#fecaca" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ──────────────────────────────────────────── */}
      {modalOpen && (
        <ModalOverlay onClose={closeModal}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623", letterSpacing: "-0.02em" }}>
              {modalMode === "add" ? "Add Instance" : "Edit Instance"}
            </div>
            <div style={{ fontSize: 13, color: "#8a9bb0", marginTop: 4 }}>
              {modalMode === "add"
                ? "Connect a TapClicks environment using its session cookie."
                : "Update instance details. Leave cookie blank to keep the existing one."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <FormField label="Instance Name" hint="e.g. Production, Staging, Client ABC">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My TapClicks Instance"
                style={inputStyle}
              />
            </FormField>

            <FormField label="Base URL" hint="The root URL of the TapClicks instance">
              <input
                type="url"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="https://app.tapclicks.com"
                style={inputStyle}
              />
            </FormField>

            <FormField
              label={modalMode === "edit" ? "Session Cookie (leave blank to keep existing)" : "Session Cookie"}
              hint="Paste the full cookie string from your browser DevTools"
            >
              <textarea
                value={form.session_cookie}
                onChange={(e) => setForm((f) => ({ ...f, session_cookie: e.target.value }))}
                placeholder="session=eyJ...; other_cookie=..."
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "'DM Mono', monospace", fontSize: 12 }}
              />
            </FormField>

            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "#455468" }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: "#2f6fed" }}
              />
              Mark as active
            </label>
          </div>

          {formError && (
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 13 }}>
              {formError}
            </div>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={closeModal} style={outlineButtonStyle}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
              {saving ? "Saving…" : modalMode === "add" ? "Add Instance" : "Save Changes"}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ──────────────────────────────────────── */}
      {deleteTarget && (
        <ModalOverlay onClose={() => setDeleteTarget(null)}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1623" }}>Delete Instance</div>
            <div style={{ fontSize: 14, color: "#627286", marginTop: 8, lineHeight: 1.6 }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setDeleteTarget(null)} style={outlineButtonStyle}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              style={{ ...primaryButtonStyle, background: "#dc2626" }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function MiniStat({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #dde5ef", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 5, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#455468", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,22,35,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#ffffff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", animation: "fadeIn 0.18s ease" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "#2f6fed",
  color: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13.5,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const outlineButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  background: "#ffffff",
  color: "#455468",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13.5,
  fontFamily: "inherit",
};

const outlineButtonSmallStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #dde5ef",
  background: "#f8fafc",
  color: "#455468",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 13px",
  borderRadius: 10,
  border: "1px solid #dde5ef",
  fontSize: 13.5,
  fontFamily: "inherit",
  color: "#0f1623",
  background: "#f8fafc",
  outline: "none",
  boxSizing: "border-box",
};

const spinnerStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid #dde5ef",
  borderTopColor: "#2f6fed",
  borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
  margin: "0 auto",
};
