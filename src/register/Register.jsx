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
    <div className="register flex h-screen max-[900px]:flex-col max-[900px]:h-auto">
      <section className="flex-1 min-w-0 p-5 max-[900px]:p-3.5 overflow-y-auto">
        {!isOnline && (
          <div className="bg-amber-tint border-[1.5px] border-amber-warn rounded-lg px-3 py-2 mb-3 text-[13px] text-amber-text font-semibold">
            Offline mode — using cached products. Sales are queued and will sync automatically.
          </div>
        )}
        <input
          className="w-full border border-line rounded-[10px] bg-surface text-ink outline-none transition-colors focus:border-accent"
          style={{
            padding: '11px 14px 11px 40px',
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238990a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat', backgroundPosition: '13px center',
          }}
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1.75 flex-wrap my-3.5">
          {categories.map(c => (
            <button
              key={c}
              className={`border rounded-full py-1.25 px-3.5 text-[12.5px] font-semibold transition-all ${
                activeCat === c ? 'bg-accent border-accent text-white' : 'border-line bg-surface text-muted hover:border-accent hover:text-accent'
              }`}
              onClick={() => setActiveCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
          {visibleProducts.map(p => (
            <button
              key={p.id}
              className={`bg-surface border border-line rounded-md text-left flex flex-col gap-2 min-h-[90px] shadow-sm transition-all hover:border-accent hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm ${p.stock <= 0 ? 'opacity-45 cursor-not-allowed' : ''}`}
              style={{ padding: '14px 13px' }}
              onClick={() => addToCartDirect(p)}
            >
              <div className="font-semibold text-[13.5px] leading-[1.25] text-ink">{p.name}</div>
              <div className="mt-auto flex justify-between items-baseline">
                <span className="font-mono font-bold text-sm text-accent">{money(p.price)}</span>
                <span className={`text-[11px] ${p.stock <= p.low_at ? 'text-amber-warn font-bold' : 'text-muted'}`}>
                  {p.stock <= 0 ? 'Out' : `${p.stock} left`}
                </span>
              </div>
            </button>
          ))}
          {visibleProducts.length === 0 && (
            <div className="col-span-full py-12 px-2.5 text-center text-muted text-sm">
              No products match — try a different search or add it in Inventory.
            </div>
          )}
        </div>
      </section>

      <aside
        className="receipt-cart w-[340px] max-[900px]:w-auto shrink-0 bg-surface shadow-md flex flex-col font-mono relative border border-line max-[900px]:rounded-md max-[900px]:max-h-none"
        style={{
          margin: '16px 16px 0 0', borderRadius: 'var(--r-md) var(--r-md) 0 0',
          padding: '18px 18px 0', maxHeight: 'calc(100vh - 16px)', borderBottom: 0,
        }}
      >
        <div className="flex justify-between text-[10.5px] tracking-[.08em] text-muted uppercase">
          <span>{settings.store_name.toUpperCase()}</span>
          <span>{new Date().toLocaleDateString('en-KE')}</span>
        </div>
        <hr className="border-0 border-t-[1.5px] border-dashed border-line my-2.5" />
        <div className="flex-1 overflow-y-auto min-h-[60px]">
          {cartLines.length === 0 && (
            <div className="text-muted text-sm py-7 text-center font-mono">Tap products to ring them up</div>
          )}
          {cartLines.map(l => (
            <div key={l.productId} className="py-2">
              <div className="flex justify-between gap-2 text-sm font-medium text-ink">
                <span>{l.product.name}</span>
                <span className="whitespace-nowrap">{money(l.line_total)}</span>
              </div>
              <div className="flex items-center gap-1.75 mt-1.25">
                <button
                  className="w-6 h-6 rounded-sm border-[1.5px] border-line bg-surface-2 text-ink text-[15px] leading-none font-bold transition-colors hover:border-accent hover:bg-accent-tint"
                  onClick={() => setQty(l.productId, l.qty - 1)}
                >
                  −
                </button>
                <span className="min-w-5 text-center font-bold text-sm">{l.qty}</span>
                <button
                  className="w-6 h-6 rounded-sm border-[1.5px] border-line bg-surface-2 text-ink text-[15px] leading-none font-bold transition-colors hover:border-accent hover:bg-accent-tint"
                  onClick={() => setQty(l.productId, l.qty + 1)}
                >
                  +
                </button>
                <span className="text-[11px] text-muted">@ {money(l.product.price)}</span>
                <button
                  className="ml-auto border-0 bg-transparent text-muted text-xs hover:text-red"
                  style={{ padding: '2px 4px' }}
                  onClick={() => setQty(l.productId, 0)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <hr className="border-0 border-t-[1.5px] border-dashed border-line my-2.5" />
        <div className="flex justify-between text-sm text-ink" style={{ padding: '3px 0' }}>
          <span>Subtotal</span><span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-ink" style={{ padding: '3px 0' }}>
          <span>
            Discount{' '}
            <input
              className="w-11 border border-line rounded-[5px] text-xs text-right bg-surface-2 text-ink outline-none focus:border-accent"
              style={{ padding: '2px 4px', fontFamily: 'inherit' }}
              type="number" min="0" max="100" value={discountPct}
              onChange={e => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
            %
          </span>
          <span>−{money(discountAmt)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold text-accent" style={{ padding: '6px 0 2px' }}>
          <span>TOTAL</span><span>{money(total)}</span>
        </div>
        <div className="flex justify-between text-muted text-[11.5px]">
          <span>VAT {settings.tax_rate}% (incl.)</span>
          <span>{money(vatIncluded.toFixed(2))}</span>
        </div>
        <div className="flex gap-2.5" style={{ padding: '14px 0 18px' }}>
          <button
            className={`border-0 rounded-[10px] font-bold text-sm bg-transparent border-[1.5px] border-line text-muted ${
              !cartLines.length ? 'opacity-50 cursor-not-allowed' : 'hover:border-red hover:text-red'
            }`}
            style={{ padding: '11px 16px' }}
            onClick={clearCart}
            disabled={!cartLines.length}
          >
            Clear
          </button>
          <button
            className="border-0 rounded-[10px] font-bold text-sm text-white flex-1 disabled:bg-surface-3 disabled:text-muted disabled:cursor-not-allowed disabled:shadow-none"
            style={{
              padding: '11px 16px',
              background: (!cartLines.length || checkingOut) ? undefined : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
              boxShadow: (!cartLines.length || checkingOut) ? undefined : '0 2px 8px rgba(184,150,58,.22), 0 4px 16px rgba(184,150,58,.14)',
            }}
            onClick={() => cartLines.length && setPayOpen(true)}
            disabled={!cartLines.length || checkingOut}
          >
            Charge {money(total)}
          </button>
        </div>
        <div
          className="h-3 -mx-4.5 translate-y-3"
          style={{
            background:
              'radial-gradient(circle at 6px 12px, var(--bg) 5px, transparent 5px) 0 0 / 12px 12px repeat-x, var(--surface)',
          }}
        />
      </aside>

      {payOpen && (
        <PaymentModal total={total} money={money} session={session} onClose={() => setPayOpen(false)} onComplete={completeSale} />
      )}
      {receipt && (
        <ReceiptModal sale={receipt} settings={settings} money={money} onClose={() => setReceipt(null)} />
      )}
      {toast && (
        <div className="fixed left-1/2 bg-sb-bg text-sb-text rounded-xl font-semibold text-sm shadow-lg whitespace-nowrap z-[99]"
          style={{ bottom: 24, transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,.1)', padding: '11px 22px' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
