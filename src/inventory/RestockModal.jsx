import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { PartnerSelect } from '../components/PartnerBadge'
import BuyingPriceInput from '../components/BuyingPriceInput'
import PricingSummary from '../components/PricingSummary'

const REASONS = [
  { value: 'restock',    label: 'Restock',    sign: +1, hint: 'Adding new stock from supplier' },
  { value: 'return',     label: 'Return',     sign: +1, hint: 'Customer return put back to shelf' },
  { value: 'adjustment', label: 'Adjustment', sign:  0, hint: 'Stock count correction (use a minus sign to reduce)' },
  { value: 'spoilage',   label: 'Spoilage',   sign: -1, hint: 'Damaged or expired items removed' },
]

export default function RestockModal({ product, partners = [], onClose, onDone }) {
  const [reason, setReason] = useState('restock')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [unitCost, setUnitCost] = useState(product.cost_price ?? '')
  const [supplier, setSupplier] = useState(product.supplier || '')
  // Increase: whose stock (partner id, null = Shared). Decrease: whose stock to
  // take first (undefined = oldest stock first).
  const [owner, setOwner] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selected = REASONS.find(r => r.value === reason)
  const isRestock = reason === 'restock'
  const qtyNum = Number(qty) || 0
  const qtyChange = selected.sign === 0 ? qtyNum : selected.sign * Math.abs(qtyNum)
  const newStock = product.stock + qtyChange
  const isIncrease = qtyChange > 0
  const needsOwner = isIncrease && partners.length > 0 && owner === undefined
  const valid = qtyNum !== 0 && (selected.sign === 0 ? true : qtyNum > 0) && !needsOwner

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
      ...(owner != null ? { partner_id: owner } : {}),
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
    <Modal title={`Restock: ${product.name}`} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {REASONS.map(r => (
          <button
            key={r.value}
            className={`cat ${reason === r.value ? 'on' : ''}`}
            onClick={() => { setReason(r.value); setOwner(undefined) }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <p className="text-[13px] text-muted mt-0 mb-3.5">
        {selected.hint}
      </p>

      <div className="field-row">
        <label className="field">
          <span>
            {selected.sign === -1 ? 'Qty to remove' :
             selected.sign === +1 ? 'Qty to add' :
             'Qty change (negative to reduce)'}
          </span>
          <input
            type="number"
            autoFocus
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder={selected.sign === 0 ? 'e.g. -3 or 5' : 'e.g. 12'}
            min={selected.sign >= 0 ? undefined : 1}
          />
        </label>
        <label className="field">
          <span>Current stock</span>
          <input value={product.stock} disabled className="text-right" />
        </label>
      </div>

      {qtyNum !== 0 && (
        <div className={`font-mono text-[15px] font-bold mb-3 ${
          newStock < 0 ? 'text-red' : newStock <= product.low_at ? 'text-amber-warn' : 'text-green'
        }`}>
          New stock: {newStock}
          {newStock < 0 ? ' (cannot go below zero)' : ''}
        </div>
      )}

      {partners.length > 0 && qtyNum !== 0 && (
        <div className="field">
          <span>{isIncrease ? 'Whose stock is this?' : 'Take from'}</span>
          <PartnerSelect
            key={isIncrease ? 'in' : 'out'}
            partners={partners}
            value={owner}
            onChange={setOwner}
            includeShared={isIncrease}
            anyLabel={isIncrease ? undefined : 'Oldest stock first (any owner)'}
          />
        </div>
      )}

      {isRestock && (
        <>
          <BuyingPriceInput qty={qtyNum} value={unitCost} onChange={setUnitCost} />
          <PricingSummary unitCost={unitCost} price={product.price} />
          <label className="field">
            <span>Supplier</span>
            <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Metro Wholesalers" />
          </label>
        </>
      )}

      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Supplier delivery #INV-442" />
      </label>

      {error && <div className="alert-error">{error}</div>}

      <Button
        size="lg" className="w-full mt-2"
        disabled={!valid || newStock < 0 || saving}
        onClick={handleSubmit}
      >
        {saving ? 'Saving...' : `Confirm ${reason}`}
      </Button>
    </Modal>
  )
}
