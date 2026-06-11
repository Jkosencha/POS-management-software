import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBarcode } from '../lib/useBarcode'
import ProductModal from './ProductModal'
import RestockModal from './RestockModal'
import StockHistoryModal from './StockHistoryModal'

export default function Inventory({ money }) {
  const [products, setProducts] = useState([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('active') // 'active' | 'low' | 'all'
  const [editProduct, setEditProduct] = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [toast, setToast] = useState(null)

  const fetchProducts = useCallback(async () => {
    const { data } = await supabase
      .from('products')
      .select('*')
      .order('category')
      .order('name')
    setProducts(data || [])
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  /* ---- barcode scanner: scan → open restock form ---- */
  const handleScan = useCallback((code) => {
    const product = products.find(p =>
      (p.barcode && p.barcode === code) || (p.sku && p.sku === code)
    )
    if (product) {
      setRestockProduct(product)
    } else {
      flash(`Code "${code}" not found — add it with the + button`)
      setEditProduct({ name: '', sku: '', barcode: code, category: '', price: '', stock: 0, low_at: 5 })
    }
  }, [products])

  // Pause scanner while any modal is open
  useBarcode(handleScan, !editProduct && !restockProduct && !historyProduct)

  const handleSave = async (data) => {
    if (data.id) {
      const { error } = await supabase.from('products').update({
        name: data.name,
        sku: data.sku || null,
        barcode: data.barcode || null,
        category: data.category,
        price: data.price,
        stock: data.stock,
        low_at: data.low_at,
      }).eq('id', data.id)
      if (error) return flash(error.message)
      flash('Product updated')
    } else {
      const { error } = await supabase.from('products').insert({
        name: data.name,
        sku: data.sku || null,
        barcode: data.barcode || null,
        category: data.category,
        price: data.price,
        stock: data.stock,
        low_at: data.low_at,
      })
      if (error) return flash(error.message)
      flash('Product added')
    }
    setEditProduct(null)
    fetchProducts()
  }

  const handleDeactivate = async (id) => {
    const { error } = await supabase.from('products').update({ active: false }).eq('id', id)
    if (error) return flash(error.message)
    flash('Product deactivated')
    setEditProduct(null)
    fetchProducts()
  }

  const lowStockCount = products.filter(p => p.active && p.stock <= p.low_at).length
  const categories = Array.from(new Set(products.map(p => p.category)))

  const list = products.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || '').toLowerCase().includes(q.toLowerCase())
    if (filter === 'active') return matchQ && p.active
    if (filter === 'low')    return matchQ && p.active && p.stock <= p.low_at
    return matchQ // 'all' — show inactive too
  })

  return (
    <div className="page">
      <header className="page-head">
        <h1>Inventory</h1>
        <button
          className="btn pay"
          onClick={() => setEditProduct({ name: '', sku: '', barcode: '', category: '', price: '', stock: 0, low_at: 5 })}
        >
          + Add product
        </button>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <input
          className="search"
          style={{ flex: 1, marginBottom: 0 }}
          placeholder="Search inventory…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="cats" style={{ margin: 0, flexShrink: 0 }}>
          <button className={`cat ${filter === 'active' ? 'on' : ''}`} onClick={() => setFilter('active')}>Active</button>
          <button
            className={`cat ${filter === 'low' ? 'on' : ''}`}
            onClick={() => setFilter('low')}
            style={lowStockCount > 0 ? { borderColor: 'var(--amber)', color: filter === 'low' ? undefined : 'var(--amber)' } : {}}
          >
            Low stock {lowStockCount > 0 && `(${lowStockCount})`}
          </button>
          <button className={`cat ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
        </div>
      </div>

      <div className="table">
        <div className="tr th" style={{ gridTemplateColumns: '2.2fr 1fr 1.2fr 1fr .8fr 1.4fr' }}>
          <span>Product</span>
          <span>SKU</span>
          <span>Category</span>
          <span className="num">Price</span>
          <span className="num">Stock</span>
          <span />
        </div>
        {list.map(p => (
          <div
            key={p.id}
            className="tr"
            style={{
              gridTemplateColumns: '2.2fr 1fr 1.2fr 1fr .8fr 1.4fr',
              opacity: !p.active ? 0.45 : 1,
              background: p.active && p.stock <= p.low_at && p.stock > 0 ? '#fffbf0' :
                          p.active && p.stock === 0 ? '#fff5f5' : undefined,
            }}
          >
            <span>{p.name}{!p.active ? ' (inactive)' : ''}</span>
            <span className="mono">{p.sku}</span>
            <span>{p.category}</span>
            <span className="num">{money(p.price)}</span>
            <span className={`num ${p.active && p.stock <= p.low_at ? 'stock-low' : ''}`}>
              {p.stock}{p.active && p.stock <= p.low_at ? ' ⚠' : ''}
            </span>
            <span className="row-act" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {p.active && (
                <button className="link" style={{ color: 'var(--green)' }} onClick={() => setRestockProduct(p)}>
                  Restock
                </button>
              )}
              <button className="link" style={{ color: 'var(--muted)' }} onClick={() => setHistoryProduct(p)}>
                History
              </button>
              <button className="link" onClick={() => setEditProduct(p)}>Edit</button>
            </span>
          </div>
        ))}
        {list.length === 0 && (
          <div className="empty-grid">
            {filter === 'low' ? 'No low-stock items — all stocked up.' : 'Nothing here yet.'}
          </div>
        )}
      </div>

      {editProduct && (
        <ProductModal
          product={editProduct}
          categories={categories}
          onSave={handleSave}
          onDeactivate={handleDeactivate}
          onClose={() => setEditProduct(null)}
        />
      )}
      {restockProduct && (
        <RestockModal
          product={restockProduct}
          onClose={() => setRestockProduct(null)}
          onDone={() => {
            setRestockProduct(null)
            flash(`${restockProduct.name} updated`)
            fetchProducts()
          }}
        />
      )}
      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
