import React, { useState } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'

export default function VoidModal({ sale, money, onClose, onVoided }) {
  const [reason, setReason]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleVoid() {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.rpc('void_sale', {
      p_sale_id: sale.id,
      p_reason:  reason.trim(),
    })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    onVoided(sale.id)
    onClose()
  }

  return (
    <Modal title="Void sale" onClose={onClose}>
      <div style={{
        background: 'var(--red-tint)', border: '1.5px solid rgba(192,57,43,.25)',
        borderRadius: 10, padding: '12px 14px', marginBottom: 16,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
          This cannot be undone.
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Sale <strong>{sale.receipt_no}</strong> ({money(sale.total)}) will be marked void
          and all items restocked.
        </div>
      </div>

      <label className="field">
        <span>Reason (required)</span>
        <input
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Customer cancelled, wrong items rung up…"
        />
      </label>

      {error && (
        <div style={{
          background: 'var(--red-tint)', border: '1.5px solid rgba(192,57,43,.3)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)',
        }}>
          {error}
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: 4 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} disabled={loading}>
          Cancel
        </button>
        <button
          className="btn danger"
          style={{ flex: 1, fontWeight: 700 }}
          disabled={!reason.trim() || loading}
          onClick={handleVoid}
        >
          {loading ? 'Voiding…' : 'Void sale'}
        </button>
      </div>
    </Modal>
  )
}
