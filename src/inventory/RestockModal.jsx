import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'

const REASONS = [
  { value: 'restock',    label: 'Restock',    sign: +1, hint: 'Adding new stock from supplier' },
  { value: 'return',     label: 'Return',     sign: +1, hint: 'Customer return put back to shelf' },
  { value: 'adjustment', label: 'Adjustment', sign:  0, hint: 'Stock count correction (use − for reduction)' },
  { value: 'spoilage',   label: 'Spoilage',   sign: -1, hint: 'Damaged or expired items removed' },
]

export default function RestockModal({ product, onClose, onDone }) {
  const [reason, setReason] = useState('restock')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [unitCost, setUnitCost] = useState(product.cost_price ?? '')
  const [supplier, setSupplier] = useState(product.supplier || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selected = REASONS.find(r => r.value === reason)
  const isRestock = reason === 'restock'
  const qtyNum = Number(qty) || 0
  const qtyChange = selected.sign === 0 ? qtyNum : selected.sign * Math.abs(qtyNum)
  const newStock = product.stock + qtyChange
  const valid = qtyNum !== 0 && (selected.sign === 0 ? true : qtyNum > 0)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    const unitCostNum = unitCost === '' ? null : Number(unitCost)

    const { error } = await supabase.from('stock_movements').insert({
      product_id: product.id,
      qty_change: qtyChange,
      reason,
      note: note.trim() || null,
      unit_cost: isRestock ? unitCostNum : null,
    })
    if (error) { setSaving(false); return setError(error.message) }

    // Restocking updates the product's current cost basis + supplier going forward
    if (isRestock && (unitCostNum != null || supplier.trim())) {
      const { error: prodError } = await supabase.from('products').update({
        ...(unitCostNum != null ? { cost_price: unitCostNum } : {}),
        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      }).eq('id', product.id)
      if (prodError) { setSaving(false); return setError(prodError.message) }
    }

    setSaving(false)
    onDone()
  }

  return (
    <Modal title={`Restock — ${product.name}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {REASONS.map(r => (
          <button
            key={r.value}
            className={`pm-method ${reason === r.value ? 'on' : ''}`}
            style={{ fontSize: 13, padding: '9px 10px' }}
            onClick={() => setReason(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
        {selected.hint}
      </p>

      <div className="field-row">
        <label className="field">
          <span>
            {selected.sign === -1 ? 'Qty to remove' :
             selected.sign === +1 ? 'Qty to add' :
             'Qty change (use − for reduction)'}
          </span>
          <input
            type="number"
            autoFocus
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder={selected.sign === 0 ? 'e.g. −3 or 5' : 'e.g. 12'}
            min={selected.sign >= 0 ? undefined : 1}
          />
        </label>
        <label className="field">
          <span>Current stock</span>
          <input value={product.stock} disabled style={{ textAlign: 'right' }} />
        </label>
      </div>

      {qtyNum !== 0 && (
        <div style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 15,
          fontWeight: 700,
          color: newStock < 0 ? 'var(--red)' : newStock <= product.low_at ? 'var(--amber)' : 'var(--green)',
          marginBottom: 12,
        }}>
          New stock: {newStock}
          {newStock < 0 ? ' — cannot go below zero' : ''}
        </div>
      )}

      {isRestock && (
        <div className="field-row">
          <label className="field">
            <span>Cost per unit (KSh)</span>
            <input
              type="number" min="0"
              value={unitCost}
              onChange={e => setUnitCost(e.target.value)}
              placeholder="What you paid"
            />
          </label>
          <label className="field">
            <span>Supplier</span>
            <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Metro Wholesalers" />
          </label>
        </div>
      )}

      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Supplier delivery #INV-442" />
      </label>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <button
        className="btn pay wide"
        disabled={!valid || newStock < 0 || saving}
        onClick={handleSubmit}
      >
        {saving ? 'Saving…' : `Confirm ${reason}`}
      </button>
    </Modal>
  )
}
