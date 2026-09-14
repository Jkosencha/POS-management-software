import React, { useState } from 'react'
import Modal from '../components/Modal'

export default function ProductModal({ product, categories, onSave, onDeactivate, onClose }) {
  const [f, setF] = useState({ ...product })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const valid = f.name.trim() && Number(f.price) >= 0 && Number(f.stock) >= 0

  return (
    <Modal title={f.id ? 'Edit product' : 'Add product'} onClose={onClose}>
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
      <label className="field">
        <span>Category</span>
        <input list="cats" value={f.category || ''} onChange={set('category')} placeholder="Dry Goods" />
        <datalist id="cats">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Price (KSh)</span>
          <input type="number" min="0" value={f.price} onChange={set('price')} />
        </label>
        <label className="field">
          <span>Cost price (KSh)</span>
          <input type="number" min="0" value={f.cost_price ?? ''} onChange={set('cost_price')} placeholder="What you pay" />
        </label>
        <label className="field">
          <span>Supplier</span>
          <input value={f.supplier || ''} onChange={set('supplier')} placeholder="e.g. Metro Wholesalers" />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Stock on hand</span>
          <input type="number" min="0" value={f.stock} onChange={set('stock')} />
        </label>
        <label className="field">
          <span>Low-stock alert at</span>
          <input type="number" min="0" value={f.low_at ?? 5} onChange={set('low_at')} />
        </label>
      </div>
      <div className="modal-actions">
        {f.id && (
          <button className="btn danger" onClick={() => onDeactivate(f.id)}>
            Deactivate
          </button>
        )}
        <button
          className="btn pay"
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
        </button>
      </div>
    </Modal>
  )
}
