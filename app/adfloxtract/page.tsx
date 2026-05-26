'use client'

import { useEffect, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'

interface Instance {
  id: string
  name: string
  base_url: string
  session_cookie: string | null
  cookie_expires_at: string | null
  last_connected_at: string | null
}

interface HistoryRun {
  id: string
  created_at: string
  entity_type: string
}

interface ResultItem {
  id: string
  name: string
  raw: unknown
  bu_names?: string[]
  is_active?: boolean
}

interface RunResult {
  id: string
  created_at: string
  entity_type: string
  record_count: number
  items: ResultItem[]
}

const EXTRACTION_TYPES = [
  { key: 'lookups',         label: 'Lookup Types' },
  { key: 'client_forms',    label: 'Client Forms' },
  { key: 'order_forms',     label: 'Order Forms' },
  { key: 'task_forms',      label: 'Task Forms' },
  { key: 'line_item_forms', label: 'Product Forms' },
  { key: 'flight_forms',    label: 'Flight Forms' },
]

const TYPE_LABEL: Record<string, string> = Object.fromEntries(EXTRACTION_TYPES.map(t => [t.key, t.label]))

// Types that support full detail export via form-details route
const FORM_DETAIL_TYPES = new Set(['client_forms', 'order_forms', 'task_forms', 'line_item_forms', 'flight_forms'])

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function cookieStatus(instance: Instance): 'active' | 'expired' | 'stored' | 'none' {
  if (!instance.session_cookie) return 'none'
  if (!instance.cookie_expires_at) return 'stored'
  return new Date(instance.cookie_expires_at) > new Date() ? 'active' : 'expired'
}

function exportManifestCsv(items: ResultItem[], entityType: string, instanceName: string) {
  if (!items.length) return
  const allKeys = new Set<string>()
  items.forEach(item => {
    if (item.raw && typeof item.raw === 'object') {
      Object.keys(item.raw as Record<string, unknown>).forEach(k => allKeys.add(k))
    }
  })
  const keys = Array.from(allKeys)
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [
    keys.join(','),
    ...items.map(item => {
      const r = (item.raw ?? {}) as Record<string, unknown>
      return keys.map(k => escape(r[k])).join(',')
    }),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${instanceName}_${entityType}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function safeSheetName(name: string, idx: number): string {
  const cleaned = name.replace(/[\\/*?[\]:]/g, '_').slice(0, 28)
  return cleaned || `Item_${idx}`
}

export default function AdfloXtractPage() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [instancesLoading, setInstancesLoading] = useState(true)
  const [instancesError, setInstancesError] = useState<string | null>(null)

  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [extractionType, setExtractionType] = useState('lookups')

  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  const [cookieInput, setCookieInput] = useState('')
  const [cookieSaving, setCookieSaving] = useState(false)
  const [cookieError, setCookieError] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryRun[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [resultLoading, setResultLoading] = useState(false)

  // Checkbox selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Lookup values
  const [lookupValues, setLookupValues] = useState<Record<string, unknown[]>>({})
  const [lookupValuesFetching, setLookupValuesFetching] = useState(false)
  const [lookupValuesError, setLookupValuesError] = useState<string | null>(null)

  // Export
  const [exportingDetails, setExportingDetails] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Search / filter
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetch('/api/tapclicks-instances')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setInstances(data as Instance[])
        else setInstancesError('Failed to load instances')
      })
      .catch(err => setInstancesError(String(err)))
      .finally(() => setInstancesLoading(false))
  }, [])

  const loadHistory = useCallback(async (instanceId: string) => {
    setHistoryLoading(true)
    setHistory([])
    setSelectedRunId(null)
    setRunResult(null)
    setSelectedIds(new Set())
    setLookupValues({})
    setLookupValuesError(null)
    try {
      const res = await fetch(`/api/xtract/history?instanceId=${instanceId}`)
      const data = await res.json() as { runs?: HistoryRun[]; error?: string }
      setHistory(data.runs ?? [])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const handleSelectInstance = (inst: Instance) => {
    setSelectedInstance(inst)
    setExtractError(null)
    setCookieInput('')
    setCookieError(null)
    loadHistory(inst.id)
  }

  const updateCookie = async () => {
    if (!selectedInstance || !cookieInput.trim()) return
    setCookieSaving(true)
    setCookieError(null)
    try {
      const res = await fetch(`/api/tapclicks-instances/${selectedInstance.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_cookie: cookieInput.trim() }),
      })
      const data = await res.json() as Partial<Instance> & { error?: string }
      if (!res.ok) { setCookieError(data.error ?? 'Failed to update cookie'); return }
      const updated = { ...selectedInstance, ...data }
      setSelectedInstance(updated)
      setInstances(prev => prev.map(i => i.id === selectedInstance.id ? updated : i))
      setCookieInput('')
      setExtractError(null)
      await runExtraction()
    } catch (err) {
      setCookieError(String(err))
    } finally {
      setCookieSaving(false)
    }
  }

  const deleteRun = async (runId: string) => {
    await fetch(`/api/xtract/history?id=${runId}`, { method: 'DELETE' })
    setHistory(prev => prev.filter(r => r.id !== runId))
    setConfirmDeleteId(null)
    if (selectedRunId === runId) {
      setSelectedRunId(null)
      setRunResult(null)
    }
  }

  const loadResult = async (runId: string) => {
    setSelectedRunId(runId)
    setRunResult(null)
    setResultLoading(true)
    setSelectedIds(new Set())
    setLookupValues({})
    setLookupValuesError(null)
    setExportError(null)
    setSearchQuery('')
    try {
      const res = await fetch(`/api/xtract/result?id=${runId}`)
      const data = await res.json() as RunResult & { error?: string }
      if (!data.error) setRunResult(data)
    } finally {
      setResultLoading(false)
    }
  }

  const runExtraction = async () => {
    if (!selectedInstance) return
    setExtracting(true)
    setExtractError(null)
    try {
      const res = await fetch('/api/xtract/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: selectedInstance.id, extractionType }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (data.error) {
        setExtractError(data.error)
      } else if (data.id) {
        await loadHistory(selectedInstance.id)
        await loadResult(data.id)
      }
    } catch (err) {
      setExtractError(String(err))
    } finally {
      setExtracting(false)
    }
  }

  // ── Lookup values ────────────────────────────────────────────────────────────

  const fetchLookupValues = async () => {
    if (!selectedInstance || !runResult) return
    setLookupValuesFetching(true)
    setLookupValuesError(null)
    try {
      const ids = runResult.items.map(i => i.id)
      const res = await fetch('/api/xtract/lookup-values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: selectedInstance.id, lookupTypeIds: ids }),
      })
      const data = await res.json() as { values?: Record<string, unknown[]>; error?: string }
      if (data.error) setLookupValuesError(data.error)
      else setLookupValues(data.values ?? {})
    } catch (err) {
      setLookupValuesError(String(err))
    } finally {
      setLookupValuesFetching(false)
    }
  }

  const exportLookupValuesXlsx = () => {
    if (!runResult || Object.keys(lookupValues).length === 0) return
    const wb = XLSX.utils.book_new()
    for (const item of runResult.items) {
      const vals = lookupValues[item.id]
      if (!vals?.length) continue
      const ws = XLSX.utils.json_to_sheet(vals as object[])
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(item.name, 0))
    }
    XLSX.writeFile(wb, `${selectedInstance!.name}_lookup_values_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Form detail export ───────────────────────────────────────────────────────

  const exportSelected = async () => {
    if (!selectedInstance || !runResult || selectedIds.size === 0) return
    setExportingDetails(true)
    setExportError(null)

    const wb = XLSX.utils.book_new()
    const items = runResult.items.filter(i => selectedIds.has(i.id))

    try {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        const res = await fetch('/api/xtract/form-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceId: selectedInstance.id,
            extractionType: runResult.entity_type,
            itemId: item.id,
          }),
        })
        const data = await res.json() as { sections?: Record<string, unknown[]>; error?: string }

        if (data.error) {
          setExportError(`${item.name}: ${data.error}`)
          setExportingDetails(false)
          return
        }

        const sections = data.sections ?? {}
        const sheetName = safeSheetName(item.name, idx)

        // Use the 'fields' section as the primary data; fall back to manifest row
        const fields = sections.fields ?? sections.flight_fields ?? []
        if (fields.length > 0) {
          const ws = XLSX.utils.json_to_sheet(fields as object[])
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
        } else {
          // Fallback: write raw manifest row
          const ws = XLSX.utils.json_to_sheet([item.raw as object])
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
        }
      }

      XLSX.writeFile(wb, `${selectedInstance.name}_${runResult.entity_type}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      setExportError(String(err))
    } finally {
      setExportingDetails(false)
    }
  }

  // ── Checkbox helpers ─────────────────────────────────────────────────────────

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filteredItems = runResult
    ? searchQuery
      ? runResult.items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : runResult.items
    : []

  const toggleAll = () => {
    if (!runResult) return
    const ids = filteredItems.map(i => i.id)
    setSelectedIds(prev => prev.size === ids.length && ids.every(id => prev.has(id)) ? new Set() : new Set(ids))
  }

  const allSelected = filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))
  const showFormExport = runResult ? FORM_DETAIL_TYPES.has(runResult.entity_type) : false
  const showLookupValues = runResult?.entity_type === 'lookups'
  const showProductCols = runResult?.entity_type === 'line_item_forms'
  const hasLookupValues = Object.keys(lookupValues).length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', fontFamily: 'DM Sans, sans-serif' }}>

      {/* Page header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde5ef', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f1623' }}>adfloXtract</h1>
        <p style={{ margin: '3px 0 0', fontSize: 13, color: '#627286' }}>
          Extract configuration data from TapClicks instances
        </p>
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left panel */}
        <div style={{
          width: 272, flexShrink: 0, borderRight: '1px solid #dde5ef',
          background: '#f8fafc', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 14px 10px', borderBottom: '1px solid #dde5ef',
            fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Instances
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
            {instancesLoading && <div style={{ padding: '20px 8px', fontSize: 13, color: '#94a3b8' }}>Loading…</div>}
            {instancesError && <div style={{ padding: '12px 8px', fontSize: 13, color: '#dc2626' }}>{instancesError}</div>}
            {!instancesLoading && !instancesError && instances.length === 0 && (
              <div style={{ padding: '20px 8px', fontSize: 13, color: '#94a3b8' }}>No instances found.</div>
            )}
            {!instancesLoading && !instancesError && instances.map(inst => {
              const status = cookieStatus(inst)
              const isSelected = selectedInstance?.id === inst.id
              return (
                <div
                  key={inst.id}
                  onClick={() => handleSelectInstance(inst)}
                  style={{
                    padding: '9px 11px', borderRadius: 8, marginBottom: 3, cursor: 'pointer',
                    background: isSelected ? '#2f6fed' : 'transparent', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(47,111,237,0.07)' }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: isSelected ? '#fff' : '#0f1623',
                    marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {inst.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: status === 'active' ? '#16a34a' : status === 'expired' ? '#dc2626' : status === 'stored' ? '#2f6fed' : '#94a3b8',
                    }} />
                    <span style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.7)' : '#94a3b8' }}>
                      {status === 'active' ? 'Cookie active' : status === 'expired' ? 'Cookie expired' : status === 'stored' ? 'Stored' : 'No cookie'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!selectedInstance ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 8 }}>
              <div style={{ fontSize: 28, color: '#dde5ef' }}>←</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Select an instance to begin</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

              {/* Top bar: header + pills + run button */}
              <div style={{ padding: '20px 24px 16px', flexShrink: 0, borderBottom: '1px solid #dde5ef' }}>

                {/* Instance header */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f1623' }}>{selectedInstance.name}</h2>
                    {cookieStatus(selectedInstance) === 'expired' && (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
                          Cookie Expired
                        </span>
                        <a href="/instances" style={{ fontSize: 12, color: '#2f6fed', textDecoration: 'none', fontWeight: 500 }}>
                          Refresh cookie on Instances page →
                        </a>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedInstance.base_url}</div>
                </div>

                {/* Extraction type pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
                  {EXTRACTION_TYPES.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setExtractionType(t.key)}
                      style={{
                        padding: '6px 13px', borderRadius: 7,
                        border: extractionType === t.key ? '1.5px solid #2f6fed' : '1.5px solid #dde5ef',
                        background: extractionType === t.key ? '#2f6fed' : '#fff',
                        color: extractionType === t.key ? '#fff' : '#627286',
                        fontSize: 13, fontWeight: extractionType === t.key ? 600 : 400,
                        cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'DM Sans, sans-serif',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Run button */}
                <button
                  onClick={runExtraction}
                  disabled={extracting}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: extracting ? '#94a3b8' : '#2f6fed', color: '#fff',
                    fontSize: 13, fontWeight: 600, cursor: extracting ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s', fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  {extracting ? 'Extracting…' : 'Run Extraction'}
                </button>

                {/* Error / cookie refresh banner */}
                {extractError && (
                  extractError.toLowerCase().includes('session expired') ? (
                    <div style={{ marginTop: 10, padding: '14px 16px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>
                        Session expired — paste a new cookie to continue.
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="password"
                          value={cookieInput}
                          onChange={e => setCookieInput(e.target.value)}
                          placeholder="Paste session cookie…"
                          style={{ flex: 1, padding: '7px 11px', borderRadius: 7, border: '1px solid #dde5ef', fontSize: 13, fontFamily: 'ui-monospace, monospace', outline: 'none' }}
                        />
                        <button
                          onClick={updateCookie}
                          disabled={cookieSaving || !cookieInput.trim()}
                          style={{
                            padding: '7px 16px', borderRadius: 7, border: 'none',
                            background: cookieSaving || !cookieInput.trim() ? '#94a3b8' : '#2f6fed',
                            color: '#fff', fontSize: 13, fontWeight: 600,
                            cursor: cookieSaving || !cookieInput.trim() ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap', fontFamily: 'DM Sans, sans-serif',
                          }}
                        >
                          {cookieSaving ? 'Saving…' : 'Update Cookie'}
                        </button>
                      </div>
                      {cookieError && <div style={{ fontSize: 12, color: '#dc2626' }}>{cookieError}</div>}
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 13, color: '#dc2626', lineHeight: 1.5 }}>
                      {extractError}
                    </div>
                  )
                )}
              </div>

              {/* Two-column body */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

                {/* Left: results (75%) */}
                <div style={{ flex: 3, overflowY: 'auto', padding: '20px 24px 32px' }}>
                  {resultLoading && (
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div>
                  )}

                  {!resultLoading && !runResult && (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 6, paddingTop: 60 }}>
                      <div style={{ fontSize: 22, color: '#dde5ef' }}>↑</div>
                      <div style={{ fontSize: 13 }}>Run an extraction to see results</div>
                    </div>
                  )}

                  {!resultLoading && runResult && (
                    <>
                      {/* Toolbar */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f1623' }}>
                            {TYPE_LABEL[runResult.entity_type] ?? runResult.entity_type}
                          </span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>
                            {runResult.record_count} record{runResult.record_count !== 1 ? 's' : ''}
                            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                          {showLookupValues && (
                            <>
                              <button
                                onClick={fetchLookupValues}
                                disabled={lookupValuesFetching}
                                style={{ padding: '5px 13px', borderRadius: 7, border: '1px solid #dde5ef', background: '#fff', color: '#627286', fontSize: 12, fontWeight: 500, cursor: lookupValuesFetching ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                              >
                                {lookupValuesFetching ? 'Fetching…' : hasLookupValues ? 'Refresh Values' : 'Fetch Values'}
                              </button>
                              {hasLookupValues && (
                                <button
                                  onClick={exportLookupValuesXlsx}
                                  style={{ padding: '5px 13px', borderRadius: 7, border: '1px solid #2f6fed', background: '#2f6fed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                >
                                  Export Values xlsx
                                </button>
                              )}
                            </>
                          )}
                          {showFormExport && selectedIds.size > 0 && (
                            <button
                              onClick={exportSelected}
                              disabled={exportingDetails}
                              style={{ padding: '5px 13px', borderRadius: 7, border: 'none', background: exportingDetails ? '#94a3b8' : '#2f6fed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: exportingDetails ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                            >
                              {exportingDetails ? 'Exporting…' : `Export Selected (${selectedIds.size}) xlsx`}
                            </button>
                          )}
                          <button
                            onClick={() => exportManifestCsv(runResult.items, runResult.entity_type, selectedInstance.name)}
                            style={{ padding: '5px 13px', borderRadius: 7, border: '1px solid #dde5ef', background: '#fff', color: '#627286', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                          >
                            Export CSV
                          </button>
                        </div>
                      </div>

                      {lookupValuesError && (
                        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>
                          {lookupValuesError}
                        </div>
                      )}
                      {exportError && (
                        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>
                          Export failed: {exportError}
                        </div>
                      )}

                      {runResult.items.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={runResult.entity_type === 'lookups' ? 'Search lookup types…' : 'Search forms…'}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              padding: '7px 11px', borderRadius: 7, border: '1px solid #dde5ef',
                              fontSize: 13, fontFamily: 'DM Sans, sans-serif', outline: 'none', color: '#0f1623',
                            }}
                          />
                        </div>
                      )}

                      {runResult.items.length === 0 ? (
                        <div style={{ fontSize: 13, color: '#94a3b8' }}>No records found.</div>
                      ) : filteredItems.length === 0 ? (
                        <div style={{ fontSize: 13, color: '#94a3b8' }}>No results match &ldquo;{searchQuery}&rdquo;.</div>
                      ) : (
                        <div style={{ border: '1px solid #dde5ef', borderRadius: 8, overflow: 'hidden' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #dde5ef' }}>
                                <th style={{ padding: '8px 12px', width: 36 }}>
                                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: '#2f6fed' }} />
                                </th>
                                <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', width: 80 }}>
                                  ID
                                </th>
                                <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                  Name
                                </th>
                                {showLookupValues && (
                                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', width: 80 }}>
                                    Values
                                  </th>
                                )}
                                {showProductCols && (
                                  <>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                      Business Unit
                                    </th>
                                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', width: 64 }}>
                                      Active
                                    </th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {filteredItems.map((item, idx) => {
                                const isChecked = selectedIds.has(item.id)
                                const valCount = lookupValues[item.id]?.length ?? null
                                return (
                                  <tr
                                    key={item.id || idx}
                                    style={{
                                      borderBottom: idx < filteredItems.length - 1 ? '1px solid #f1f5f9' : 'none',
                                      background: isChecked ? 'rgba(47,111,237,0.03)' : 'transparent',
                                    }}
                                  >
                                    <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                                      <input type="checkbox" checked={isChecked} onChange={() => toggleItem(item.id)} style={{ cursor: 'pointer', accentColor: '#2f6fed' }} />
                                    </td>
                                    <td style={{ padding: '6px 10px', color: '#94a3b8', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                                      {item.id}
                                    </td>
                                    <td style={{ padding: '6px 10px', color: '#0f1623' }}>
                                      {item.name || <span style={{ color: '#c8d5e8' }}>—</span>}
                                    </td>
                                    {showLookupValues && (
                                      <td style={{ padding: '6px 10px', textAlign: 'right', color: valCount !== null ? '#627286' : '#c8d5e8', fontSize: 12 }}>
                                        {valCount !== null ? valCount : lookupValuesFetching ? '…' : '—'}
                                      </td>
                                    )}
                                    {showProductCols && (
                                      <>
                                        <td style={{ padding: '6px 10px', color: '#627286', fontSize: 12 }}>
                                          {item.bu_names?.join(', ') || <span style={{ color: '#c8d5e8' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: item.is_active ? '#16a34a' : '#c8d5e8' }} />
                                        </td>
                                      </>
                                    )}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Right: history (25%) */}
                <div style={{
                  width: '25%', flexShrink: 0,
                  borderLeft: '1px solid #dde5ef',
                  background: '#f8fafc',
                  overflowY: 'auto',
                  padding: '16px 12px 32px',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                    History
                  </div>
                  {historyLoading && <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>}
                  {!historyLoading && history.length === 0 && (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>No extractions yet.</div>
                  )}
                  {!historyLoading && history.map(run => {
                    const isPendingDelete = confirmDeleteId === run.id
                    const isActive = selectedRunId === run.id
                    return (
                      <div
                        key={run.id}
                        onClick={() => { if (!isPendingDelete) loadResult(run.id) }}
                        style={{
                          padding: '7px 9px', borderRadius: 7, marginBottom: 3,
                          background: isPendingDelete ? 'rgba(239,68,68,0.05)' : isActive ? 'rgba(47,111,237,0.07)' : 'transparent',
                          border: isPendingDelete ? '1px solid #fecaca' : isActive ? '1px solid rgba(47,111,237,0.25)' : '1px solid transparent',
                          cursor: isPendingDelete ? 'default' : 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isPendingDelete && !isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.04)' }}
                        onMouseLeave={e => { if (!isPendingDelete && !isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      >
                        {isPendingDelete ? (
                          <div onClick={e => e.stopPropagation()}>
                            <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>Delete this extraction?</div>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <button
                                onClick={() => deleteRun(run.id)}
                                style={{ flex: 1, padding: '3px 0', borderRadius: 5, border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                style={{ flex: 1, padding: '3px 0', borderRadius: 5, border: '1px solid #dde5ef', background: '#fff', color: '#627286', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#2f6fed' : '#0f1623', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {TYPE_LABEL[run.entity_type] ?? run.entity_type}
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                                {formatDate(run.created_at)}
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(run.id) }}
                              style={{ flexShrink: 0, padding: '2px 5px', borderRadius: 4, border: '1px solid transparent', background: 'transparent', color: '#c8d5e8', fontSize: 10, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.4, marginTop: 1 }}
                              onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.borderColor = '#fecaca' }}
                              onMouseLeave={e => { e.currentTarget.style.color = '#c8d5e8'; e.currentTarget.style.borderColor = 'transparent' }}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
