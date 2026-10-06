import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { SHARED } from '../lib/partners'
import { PartnerSelect, PartnerBadge } from '../components/PartnerBadge'

/*
 * A product's stock on hand, batch by batch, with its owner. Changing an
 * owner saves straight away. "Move all to" re-assigns every remaining batch
 * of the product in one go. Shared by Edit product and Stock history.
 */
export default function BatchOwners({ productId, partners = [], onChanged }) {
  const [batches, setBatches] = useState([])
  const [error, setError]     = useState(null)
  const [saving, setSaving]   = useState(false)

  const fetchBatches = useCallback(() => supabase
    .from('stock_batches')
    .select('id, partner_id, qty_remaining, qty_received, unit_cost, created_at')
    .eq('product_id', productId)
    .gt('qty_remaining', 0)
    .order('created_at')
    .then(({ data }) => setBatches(data || [])), [productId])

  useEffect(() => { fetchBatches() }, [fetchBatches])

  async function reassign(partnerId, batchId) {
    setSaving(true)
    setError(null)
    let query = supabase.from('stock_batches').update({ partner_id: partnerId })
    query = batchId
      ? query.eq('id', batchId)
      : query.eq('product_id', productId).gt('qty_remaining', 0)
    const { error } = await query
    setSaving(false)
    if (error) return setError(error.message)
    fetchBatches()
    onChanged?.()
  }

  if (batches.length === 0) return null

  // Pre-select "Move all to" when every batch already has the same owner
  const owners = new Set(batches.map(b => b.partner_id))
  const commonOwner = owners.size === 1 ? batches[0].partner_id : undefined

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-muted">Stock by owner (sold oldest first)</span>
        {partners.length > 0 && batches.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Move all to</span>
            <PartnerSelect
              key={String(commonOwner)}
              partners={partners}
              value={commonOwner}
              onChange={v => v !== undefined && reassign(v)}
              placeholder="Choose..."
              size="sm"
              className="w-[150px] rounded-full"
            />
          </div>
        )}
      </div>
      {error && <div className="alert-error">{error}</div>}
      <div className={`rounded-sm border border-line divide-y divide-line ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
        {batches.map(b => {
          const p = partners.find(x => x.id === b.partner_id) || SHARED
          return (
            <div key={b.id} className="flex items-center gap-3 px-3 py-2" style={{ boxShadow: `inset 3px 0 0 ${p.color}` }}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{b.qty_remaining} <span className="text-muted font-normal">of {b.qty_received} left</span></div>
                <div className="text-[11px] text-muted">
                  {new Date(b.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {b.unit_cost != null ? ` · cost ${b.unit_cost}` : ''}
                </div>
              </div>
              {partners.length > 0 ? (
                <PartnerSelect
                  partners={partners}
                  value={b.partner_id}
                  onChange={v => reassign(v, b.id)}
                  size="sm"
                  className="w-[170px] rounded-full"
                />
              ) : (
                <PartnerBadge partner={p} />
              )}
            </div>
          )
        })}
      </div>
      {partners.length > 0 && <p className="text-[11px] text-muted mt-1.5 mb-0">Owner changes save immediately.</p>}
    </div>
  )
}
