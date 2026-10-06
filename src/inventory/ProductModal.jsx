import React, { useState } from 'react'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PartnerSelect } from '../components/PartnerBadge'
import BatchOwners from './BatchOwners'
import BuyingPriceInput from '../components/BuyingPriceInput'
import PricingSummary from '../components/PricingSummary'

function Section({ title, children }) {
  return (
    <section className="mb-2">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-accent">{title}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  )
}

export default function ProductModal({ product, categories, partners = [], onSave, onSetActive, onOwnersChanged, onClose }) {
  const [f, setF] = useState({ ...product, partner_id: undefined })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const isNew = !f.id
  // New stock needs an owner once partners exist (null = Shared is a valid choice)
  const needsOwner = isNew && partners.length > 0 && Number(f.stock) > 0 && f.partner_id === undefined
  const valid = f.name.trim() && f.category && Number(f.price) >= 0 && Number(f.stock) >= 0 && !needsOwner

  // Active categories, plus the product's current one even if it was deactivated
  const options = categories
    .filter(c => c.active || c.name === product.category)
    .map(c => c.name)

  return (
    <Modal title={f.id ? 'Edit product' : 'Add product'} onClose={onClose} className="max-w-[580px]">
      <Section title="Details">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Cooking Oil 1L" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>SKU / code</span>
            <input value={f.sku || ''} onChange={set('sku')} placeholder="OIL1L" />
          </label>
          <label className="field">
            <span>Barcode (optional)</span>
            <input value={f.barcode || ''} onChange={set('barcode')} placeholder="5901234123457" />
          </label>
        </div>
        <div className="field-row">
          <div className="field">
            <span>Category</span>
            <Select value={f.category || undefined} onValueChange={v => setF({ ...f, category: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {options.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {options.length === 0 && (
              <span className="text-xs text-muted font-normal">Add a category on the Categories page first.</span>
            )}
          </div>
          <label className="field">
            <span>Supplier (optional)</span>
            <input value={f.supplier || ''} onChange={set('supplier')} placeholder="e.g. Metro Wholesalers" />
          </label>
        </div>
      </Section>

      <Section title="Stock">
        {isNew ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>Opening stock</span>
                <input type="number" min="0" value={f.stock} onChange={set('stock')} />
              </label>
              <label className="field">
                <span>Low-stock alert at</span>
                <input type="number" min="0" value={f.low_at ?? 5} onChange={set('low_at')} />
              </label>
            </div>
            {partners.length > 0 && (
              <div className="field">
                <span>Whose stock?</span>
                <PartnerSelect partners={partners} value={f.partner_id} onChange={v => setF({ ...f, partner_id: v })} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field-row">
              <div className="field">
                <span>Stock on hand</span>
                <div className="text-sm text-ink-2 rounded-sm bg-surface-2 px-3 py-2.5">
                  <strong className="text-ink">{f.stock}</strong> units (use Restock to change)
                </div>
              </div>
              <label className="field">
                <span>Low-stock alert at</span>
                <input type="number" min="0" value={f.low_at ?? 5} onChange={set('low_at')} />
              </label>
            </div>
            {f.stock > 0 && (
              <div className="mb-3">
                <BatchOwners productId={f.id} partners={partners} onChanged={onOwnersChanged} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Pricing">
        {/* New products can enter a bulk total for the opening stock */}
        <BuyingPriceInput
          qty={isNew ? Number(f.stock) || 0 : undefined}
          value={f.cost_price ?? ''}
          onChange={v => setF(prev => ({ ...prev, cost_price: v }))}
        />
        <PricingSummary
          unitCost={f.cost_price}
          price={f.price}
        />
        <label className="field">
          <span>Selling price per unit (KSh)</span>
          <input type="number" min="0" step="any" value={f.price} onChange={set('price')} placeholder="What customers pay" />
        </label>
      </Section>

      <div className="flex gap-2.5 mt-2">
        {f.id && (f.active === false ? (
          <Button variant="outline" onClick={() => onSetActive(f.id, true)}>Reactivate</Button>
        ) : (
          <Button variant="destructive-outline" onClick={() => onSetActive(f.id, false)}>Deactivate</Button>
        ))}
        <Button
          className="flex-1"
          disabled={!valid}
          onClick={() => onSave({
            ...f,
            price: Number(f.price),
            cost_price: f.cost_price === '' || f.cost_price == null ? null : Number(f.cost_price),
            supplier: f.supplier?.trim() || null,
            stock: Number(f.stock),
            low_at: Number(f.low_at) || 5,
          })}
        >
          Save product
        </Button>
      </div>
    </Modal>
  )
}
