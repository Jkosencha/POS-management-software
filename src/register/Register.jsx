import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { vatFromTotal } from '../lib/money'
import { useBarcode } from '../lib/useBarcode'
import { useSession } from '../auth/useSession'
import { cacheProducts, getCachedProducts, enqueueSale } from '../lib/offlineStore'
import PaymentModal from './PaymentModal'
import ReceiptModal from './ReceiptModal'

export default function Register({ settings, money, isOnline, onSaleQueued }) {
  const { session } = useSession()
  const [products, setProducts]     = useState([])
  const [cart, setCart]             = useState([])
  const [search, setSearch]         = useState('')
  const [activeCat, setActiveCat]   = useState('All')
  const [discountPct, setDiscountPct] = useState(0)
  const [payOpen, setPayOpen]       = useState(false)
  const [receipt, setReceipt]       = useState(null)
  const [toast, setToast]           = useState(null)
  const [checkingOut, setCheckingOut] = useState(false)

  const fetchProducts = useCallback(async () => {
    if (!navigator.onLine) {
      const cached = await getCachedProducts().catch(() => null)
      if (cached) setProducts(cached)
      return
    }
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('category')
      .order('name')
    const list = data || []
    setProducts(list)
    cacheProducts(list).catch(() => {})  // best-effort cache update
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  // Refetch products when reconnecting
  useEffect(() => {
    const handleOnline = () => fetchProducts()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [fetchProducts])

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  /* ---- barcode scanner ---- */
  const handleScan = useCallback((code) => {
    setSearch('')
    const product = products.find(p =>
      (p.barcode && p.barcode === code) || (p.sku && p.sku === code)
    )
    if (product) {
      addToCartDirect(product)
    } else {
      flash(`Code "${code}" not found — add it in Inventory`)
    }
  }, [products]) // eslint-disable-line react-hooks/exhaustive-deps

  useBarcode(handleScan, !payOpen && !receipt)

  /* ---- cart ---- */
  const cartLines = cart.map(l => {
    const p = products.find(x => x.id === l.productId)
    return { ...l, product: p, line_total: p ? p.price * l.qty : 0 }
  })

  const subtotal    = cartLines.reduce((s, l) => s + l.line_total, 0)
  const discountAmt = Math.round(subtotal * (discountPct / 100))
  const total       = subtotal - discountAmt
  const vatIncluded = vatFromTotal(total, settings.tax_rate)

  const addToCartDirect = (p) => {
    if (p.stock <= 0) return flash(`${p.name} is out of stock`)
    setCart(c => {
      const ex = c.find(l => l.productId === p.id)
      if (ex) {
        if (ex.qty >= p.stock) { flash(`Only ${p.stock} in stock`); return c }
        return c.map(l => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)
      }
      return [...c, { productId: p.id, qty: 1 }]
    })
  }

  const setQty = (productId, qty) => {
    const p = products.find(x => x.id === productId)
    if (qty > p.stock) { flash(`Only ${p.stock} in stock`); qty = p.stock }
    if (qty <= 0) return setCart(c => c.filter(l => l.productId !== productId))
    setCart(c => c.map(l => l.productId === productId ? { ...l, qty } : l))
  }

  const clearCart = () => { setCart([]); setDiscountPct(0) }

  const completeSale = async ({ method, tendered, ref }) => {
    setCheckingOut(true)
    const items   = cartLines.map(l => ({ product_id: l.product.id, qty: l.qty }))
    const payment = {
      method,
      tendered:    method === 'Cash' ? tendered : total,
      change:      method === 'Cash' ? tendered - total : 0,
      mpesa_ref:   ref || '',
      discount_pct: discountPct,
    }

    /* ---- offline path ---- */
    if (!navigator.onLine) {
      const saleId = crypto.randomUUID()
      await enqueueSale({ id: saleId, items, payment, created_at: new Date().toISOString() })

      // Optimistically deduct stock so the cashier can't oversell while offline
      setProducts(prev => prev.map(p => {
        const line = cartLines.find(l => l.productId === p.id)
        return line ? { ...p, stock: Math.max(0, p.stock - line.qty) } : p
      }))

      const offlineReceipt = {
        receipt_no:   'Q-' + saleId.slice(0, 8).toUpperCase(),
        created_at:   new Date().toISOString(),
        items:        cartLines.map(l => ({ name: l.product.name, qty: l.qty, line_total: l.line_total })),
        subtotal,
        discount_pct: discountPct,
        discount_amt: discountAmt,
        total,
        vat_amount:   vatFromTotal(total, settings.tax_rate),
        method,
        tendered:     payment.tendered,
        change:       payment.change,
        mpesa_ref:    ref || '',
        offline:      true,
      }

      clearCart()
      setPayOpen(false)
      setReceipt(offlineReceipt)
      onSaleQueued?.()
      setCheckingOut(false)
      return
    }

    /* ---- online path ---- */
    const { data, error } = await supabase.rpc('checkout', {
      p_items:   items,
      p_payment: payment,
    })

    if (error) {
      flash(error.message)
      setCheckingOut(false)
      return
    }

    const saleForReceipt = {
      receipt_no:   data.receipt_no,
      created_at:   new Date().toISOString(),
      items:        cartLines.map(l => ({ name: l.product.name, qty: l.qty, line_total: l.line_total })),
      subtotal,
      discount_pct: discountPct,
      discount_amt: discountAmt,
      total:        data.total,
      vat_amount:   data.vat_amount,
      method,
      tendered:     payment.tendered,
      change:       payment.change,
      mpesa_ref:    ref || '',
    }

    clearCart()
    setPayOpen(false)
    setReceipt(saleForReceipt)
    await fetchProducts()
    setCheckingOut(false)
  }

  /* ---- derived ---- */
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))]
  const visibleProducts = products.filter(p => {
    const q = search.trim().toLowerCase()
    return (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
        && (activeCat === 'All' || p.category === activeCat)
  })

  return (
    <div className="register">
      <section className="picker">
        {!isOnline && (
          <div style={{
            background: '#fff8ec', border: '1.5px solid var(--amber)', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#7a5000', fontWeight: 600,
          }}>
            Offline mode — using cached products. Sales are queued and will sync automatically.
          </div>
        )}
        <input
          className="search"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="cats">
          {categories.map(c => (
            <button key={c} className={`cat ${activeCat === c ? 'on' : ''}`} onClick={() => setActiveCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid">
          {visibleProducts.map(p => (
            <button
              key={p.id}
              className={`tile ${p.stock <= 0 ? 'out' : ''}`}
              onClick={() => addToCartDirect(p)}
            >
              <div className="tile-name">{p.name}</div>
              <div className="tile-meta">
                <span className="tile-price">{money(p.price)}</span>
                <span className={`tile-stock ${p.stock <= p.low_at ? 'low' : ''}`}>
                  {p.stock <= 0 ? 'Out' : `${p.stock} left`}
                </span>
              </div>
            </button>
          ))}
          {visibleProducts.length === 0 && (
            <div className="empty-grid">No products match — try a different search or add it in Inventory.</div>
          )}
        </div>
      </section>

      <aside className="receipt-cart">
        <div className="rc-head">
          <span>{settings.store_name.toUpperCase()}</span>
          <span>{new Date().toLocaleDateString('en-KE')}</span>
        </div>
        <div className="rc-rule" />
        <div className="rc-lines">
          {cartLines.length === 0 && <div className="rc-empty">Tap products to ring them up</div>}
          {cartLines.map(l => (
            <div key={l.productId} className="rc-line">
              <div className="rc-line-top">
                <span className="rc-name">{l.product.name}</span>
                <span className="rc-amt">{money(l.line_total)}</span>
              </div>
              <div className="rc-line-ctl">
                <button className="qty-btn" onClick={() => setQty(l.productId, l.qty - 1)}>−</button>
                <span className="qty">{l.qty}</span>
                <button className="qty-btn" onClick={() => setQty(l.productId, l.qty + 1)}>+</button>
                <span className="rc-unit">@ {money(l.product.price)}</span>
                <button className="rc-del" onClick={() => setQty(l.productId, 0)}>✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="rc-rule" />
        <div className="rc-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        <div className="rc-row rc-discount">
          <span>
            Discount{' '}
            <input
              type="number" min="0" max="100" value={discountPct}
              onChange={e => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
            %
          </span>
          <span>−{money(discountAmt)}</span>
        </div>
        <div className="rc-row rc-total"><span>TOTAL</span><span>{money(total)}</span></div>
        <div className="rc-row rc-vat">
          <span>VAT {settings.tax_rate}% (incl.)</span>
          <span>{money(vatIncluded.toFixed(2))}</span>
        </div>
        <div className="rc-actions">
          <button className="btn ghost" onClick={clearCart} disabled={!cartLines.length}>Clear</button>
          <button
            className="btn pay"
            onClick={() => cartLines.length && setPayOpen(true)}
            disabled={!cartLines.length || checkingOut}
          >
            Charge {money(total)}
          </button>
        </div>
        <div className="rc-tear" />
      </aside>

      {payOpen && (
        <PaymentModal total={total} money={money} session={session} onClose={() => setPayOpen(false)} onComplete={completeSale} />
      )}
      {receipt && (
        <ReceiptModal sale={receipt} settings={settings} money={money} onClose={() => setReceipt(null)} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
