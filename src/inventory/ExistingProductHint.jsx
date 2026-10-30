import React from 'react'
import { PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Compare names ignoring case, spaces and punctuation: "Soda-500ML" == "soda 500ml"
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const MIN_NAME = 4    // don't start matching on 1-3 typed characters
const MAX_SHOWN = 3

/*
 * While adding a product, list existing products that look like the same
 * thing (similar name, same SKU or same barcode) so stock gets restocked
 * instead of being entered twice.
 */
export function findExisting(draft, products) {
  const name = norm(draft.name)
  const sku = norm(draft.sku)
  const barcode = (draft.barcode || '').trim()
  return products
    .map(p => {
      const pn = norm(p.name)
      const exactCode = (sku && norm(p.sku) === sku) || (barcode && p.barcode === barcode)
      const nameHit = name.length >= MIN_NAME && pn.length >= MIN_NAME && (pn.includes(name) || name.includes(pn))
      return exactCode || nameHit ? { p, exactCode, exactName: pn === name } : null
    })
    .filter(Boolean)
    // Exact SKU/barcode first, then exact names, then partial names
    .sort((a, b) => (b.exactCode - a.exactCode) || (b.exactName - a.exactName))
    .slice(0, MAX_SHOWN)
}

export default function ExistingProductHint({ draft, products, onRestock }) {
  const found = findExisting(draft, products)
  if (found.length === 0) return null

  return (
    <div className="rounded-md border border-amber-warn/40 bg-amber-tint px-3.5 py-3 mb-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-text mb-2">
        <PackageCheck size={16} />
        {found.some(x => x.exactCode || x.exactName) ? 'This product is already in your inventory' : 'Similar products are already in your inventory'}
      </div>
      <div className="flex flex-col gap-1.5">
        {found.map(({ p, exactCode }) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-sm bg-surface px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{p.name}</div>
              <div className="text-xs text-muted">
                {p.category} · {p.stock} in stock{p.sku ? ` · ${p.sku}` : ''}
                {exactCode && <span className="text-amber-text font-semibold"> · same code</span>}
                {!p.active && ' · inactive'}
              </div>
            </div>
            {p.active && onRestock ? (
              <Button type="button" size="sm" onClick={() => onRestock(p)}>Restock instead</Button>
            ) : (
              <span className="text-xs text-muted shrink-0">Reactivate it in Inventory</span>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-amber-text mt-2 mb-0">
        To add more of an existing product, restock it so its stock and history stay in one place.
      </p>
    </div>
  )
}
