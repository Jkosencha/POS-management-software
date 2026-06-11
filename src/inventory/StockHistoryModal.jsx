import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'

const REASON_COLORS = {
  sale:       { color: 'var(--ink)',   bg: '#e8e4dc' },
  restock:    { color: '#fff',         bg: 'var(--green)' },
  return:     { color: '#fff',         bg: '#0a7a5a' },
  adjustment: { color: 'var(--ink)',   bg: 'var(--amber)' },
  spoilage:   { color: '#fff',         bg: 'var(--red)' },
}

function ReasonBadge({ reason }) {
  const style = REASON_COLORS[reason] || { color: 'var(--ink)', bg: 'var(--line)' }
  return (
    <span style={{
      background: style.bg, color: style.color,
      fontSize: 11, fontWeight: 700, borderRadius: 99,
      padding: '2px 8px', letterSpacing: '.04em', textTransform: 'uppercase',
    }}>
      {reason}
    </span>
  )
}

export default function StockHistoryModal({ product, onClose }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('stock_movements')
      .select('*, profiles(full_name)')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setMovements(data || [])
        setLoading(false)
      })
  }, [product.id])

  const runningStock = []
  let running = product.stock
  for (const m of movements) {
    runningStock.push(running)
    running -= m.qty_change
  }

  return (
    <Modal title={`Stock history — ${product.name}`} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontFamily: 'IBM Plex Mono, monospace' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Current stock</span>
        <span style={{ fontSize: 19, fontWeight: 700 }}>{product.stock}</span>
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>}

      {!loading && movements.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No movements recorded yet.</p>
      )}

      {!loading && movements.length > 0 && (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {movements.map((m, i) => (
            <div key={m.id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: '4px 12px',
              padding: '10px 0',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              alignItems: 'start',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 13,
            }}>
              <div>
                <ReasonBadge reason={m.reason} />
                {m.note && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>{m.note}</div>
                )}
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>
                  {new Date(m.created_at).toLocaleString('en-KE')}
                  {m.profiles?.full_name ? ` · ${m.profiles.full_name}` : ''}
                </div>
              </div>
              <div style={{
                fontWeight: 700,
                fontSize: 15,
                color: m.qty_change > 0 ? 'var(--green)' : 'var(--red)',
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}>
                {m.qty_change > 0 ? '+' : ''}{m.qty_change}
              </div>
              <div style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 13 }}>
                → {runningStock[i]}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
