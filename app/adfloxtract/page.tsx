'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Instance {
  id: string
  name: string
  base_url: string
  is_active: boolean
  cookie_expires_at: string | null
  last_connected_at: string | null
  display_order: number
  created_at: string
}

type CookieStatus = 'active' | 'expired' | 'unknown'

function getCookieStatus(instance: Instance): CookieStatus {
  if (!instance.cookie_expires_at) return 'unknown'
  return new Date(instance.cookie_expires_at) > new Date() ? 'active' : 'expired'
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase()
}

function formatDate(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_STYLES: Record<CookieStatus, { background: string; color: string; label: string }> = {
  active:  { background: 'rgba(34,197,94,0.12)',  color: '#16a34a', label: 'Cookie Active'  },
  expired: { background: 'rgba(239,68,68,0.12)',  color: '#dc2626', label: 'Cookie Expired' },
  unknown: { background: 'rgba(148,163,184,0.15)', color: '#64748b', label: 'Unknown'        },
}

export default function AdfloXtractPage() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchInstances() {
      setLoading(true)
      const { data, error } = await supabase
        .from('instances')
        .select('id, name, base_url, is_active, cookie_expires_at, last_connected_at, display_order, created_at')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        setInstances(data ?? [])
      }
      setLoading(false)
    }

    fetchInstances()
  }, [])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0f1623' }}>
          adfloXtract
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#627286' }}>
          TapClicks instances — click an instance to view export options
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#8a9bb0', fontSize: 14 }}>
          Loading instances…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 12,
          padding: '16px 20px',
          color: '#dc2626',
          fontSize: 14,
        }}>
          <strong>Failed to load instances:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && instances.length === 0 && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #dde5ef',
          borderRadius: 16,
          padding: '48px 32px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🖥️</div>
          <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No instances yet</div>
          <div style={{ fontSize: 14, color: '#627286' }}>
            Instances are added via the Instances page in the sidebar.
          </div>
        </div>
      )}

      {/* Instance list */}
      {!loading && !error && instances.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {instances.map((instance) => {
            const cookieStatus = getCookieStatus(instance)
            const statusStyle = STATUS_STYLES[cookieStatus]

            return (
              <div
                key={instance.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #dde5ef',
                  borderRadius: 16,
                  padding: '18px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'box-shadow 0.15s, border-color 0.15s',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = '#2f6fed'
                  el.style.boxShadow = '0 2px 12px rgba(47,111,237,0.08)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = '#dde5ef'
                  el.style.boxShadow = 'none'
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #2f6fed22, #4fbf9f22)',
                  border: '1px solid #dde5ef',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#2f6fed',
                  flexShrink: 0,
                }}>
                  {getInitial(instance.name)}
                </div>

                {/* Name + URL */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: '#0f1623',
                    marginBottom: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {instance.name}
                  </div>
                  <a
                    href={instance.base_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 13,
                      color: '#627286',
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#2f6fed')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#627286')}
                  >
                    {instance.base_url}
                  </a>
                </div>

                {/* Meta: last connected + badges */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 6,
                  flexShrink: 0,
                }}>
                  {/* Cookie status badge */}
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: statusStyle.background,
                    color: statusStyle.color,
                  }}>
                    {statusStyle.label}
                  </span>

                  {/* Active / Inactive badge */}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: instance.is_active ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.12)',
                    color: instance.is_active ? '#16a34a' : '#94a3b8',
                  }}>
                    {instance.is_active ? 'Active' : 'Inactive'}
                  </span>

                  {/* Last connected */}
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    Last connected: {formatDate(instance.last_connected_at)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Instance count footer */}
      {!loading && !error && instances.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
          {instances.length} instance{instances.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
