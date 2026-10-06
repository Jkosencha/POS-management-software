import React, { useState } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'
import { verifyPassword } from '../lib/verifyPassword'
import { Button } from '@/components/ui/button'

export default function VoidModal({ sale, money, onClose, onVoided }) {
  const [reason, setReason]   = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleVoid() {
    setLoading(true)
    setError(null)
    const authError = await verifyPassword(password)
    if (authError) {
      setError(authError)
      setLoading(false)
      return
    }
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
      <div className="rounded-sm bg-red-tint border border-red/25 px-3.5 py-3 mb-4">
        <div className="font-bold text-red mb-1">This cannot be undone.</div>
        <div className="text-[13px] text-ink-2 leading-normal">
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
          placeholder="e.g. Customer cancelled, wrong items rung up"
        />
      </label>

      <label className="field">
        <span>Your password (required)</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && reason.trim() && password && !loading) handleVoid() }}
        />
      </label>

      {error && <div className="alert-error">{error}</div>}

      <div className="flex gap-2.5 mt-1">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={!reason.trim() || !password || loading}
          onClick={handleVoid}
        >
          {loading ? 'Voiding...' : 'Void sale'}
        </Button>
      </div>
    </Modal>
  )
}
