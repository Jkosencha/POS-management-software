import React, { useState, useEffect, useCallback } from 'react'
import { Search, Minus, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { vatFromTotal } from '../lib/money'
import { useBarcode } from '../lib/useBarcode'
import { cacheProducts, getCachedProducts, enqueueSale } from '../lib/offlineStore'
import PaymentModal from './PaymentModal'
import ReceiptModal from './ReceiptModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Cashiers may discount up to 20%; managers/owners up to 100% (also enforced in checkout())
export const MAX_DISCOUNT = { cashier: 20, manager: 100, owner: 100 }

export default function Register({ settings, money, isOnline, onSaleQueued, role = 'cashier', userId }) {
  const maxDiscount = MAX_DISCOUNT[role] ?? 20
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
    const [{ data }, { data: inactiveCats }] = await Promise.all([
      fetchAll(() => supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('category')
        .order('name')
        .order('id')),
      // Errors (e.g. migration 009 not run yet) just mean nothing is hidden
      supabase.from('categories').select('name').eq('active', false),
    ])
    // Products in a deactivated category are hidden from the register
    const hidden = new Set((inactiveCats || []).map(c => c.name))
    const list = (data || []).filter(p => !hidden.has(p.category))
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
      flash(`Code "${code}" not found. Add it in Inventory.`)
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
      // Keeps an offline sale credited to whoever rang it up, even if
      // someone else is logged in when it syncs
      cashier_id:   userId,
    }
    // Unique per sale: lets the server ignore a retried duplicate
    const saleId = crypto.randomUUID()
    const ringTime = new Date().toISOString()

    /* ---- offline path (also used when the network drops mid-checkout) ---- */
    const queueOffline = async () => {
      await enqueueSale({
        id: saleId, items, payment, created_at: ringTime,
        // Human-readable copy for the "offline sales" review screen
        summary: { total, lines: cartLines.map(l => ({ name: l.product.name, qty: l.qty })) },
      })

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
    }

    if (!navigator.onLine) return queueOffline()

    /* ---- online path ---- */
    const { data, error } = await supabase.rpc('checkout', {
      p_items:   items,
      p_payment: { ...payment, client_id: saleId },
    })

    // No response at all = network failure: the sale may or may not have
    // reached the server. Queue it; client_id stops it being recorded twice.
    if (error && !error.code && /fetch|network/i.test(error.message || '')) {
      return queueOffline()
    }

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
    <div className="flex h-full max-[900px]:flex-col max-[900px]:h-auto">
      <section className="flex-1 min-w-0 p-4 sm:p-5 overflow-y-auto">
        {!isOnline && (
          <div className="alert-warn">
            Offline mode: using cached products. Sales are queued and will sync automatically.
          </div>
        )}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input
            className="pl-10 rounded-full h-11 shadow-sm border-transparent"
            placeholder="Search by name or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap my-3.5">
          {categories.map(c => (
            <button key={c} className={`cat ${activeCat === c ? 'on' : ''}`} onClick={() => setActiveCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {visibleProducts.map(p => (
            <button
              key={p.id}
              className={`bg-surface rounded-md text-left flex flex-col gap-2 min-h-[96px] p-3.5 shadow-sm border border-transparent transition-all hover:border-accent hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${p.stock <= 0 ? 'opacity-45 cursor-not-allowed' : ''}`}
              onClick={() => addToCartDirect(p)}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{p.category}</div>
              <div className="font-semibold text-[13.5px] leading-[1.25] text-ink -mt-1">{p.name}</div>
              <div className="mt-auto flex justify-between items-baseline gap-1">
                <span className="font-mono font-bold text-sm text-accent">{money(p.price)}</span>
                <span className={`text-[11px] ${p.stock <= p.low_at ? 'text-red font-bold' : 'text-muted'}`}>
                  {p.stock <= 0 ? 'Out' : `${p.stock} left`}
                </span>
              </div>
            </button>
          ))}
          {visibleProducts.length === 0 && (
            <div className="col-span-full py-12 px-2.5 text-center text-muted text-sm">
              No products match. Try a different search or add it in Inventory.
            </div>
          )}
        </div>
      </section>

      <aside className="receipt-cart m-4 ml-0 max-[900px]:m-4 max-[900px]:mt-0 rounded-lg p-4.5 pb-0 overflow-hidden">
        <div className="flex justify-between text-[10.5px] tracking-[.08em] text-muted uppercase">
          <span>{settings.store_name.toUpperCase()}</span>
          <span>{new Date().toLocaleDateString('en-KE')}</span>
        </div>
        <hr className="rc-rule" />
        <div className="flex-1 overflow-y-auto min-h-[60px]">
          {cartLines.length === 0 && (
            <div className="text-muted text-sm py-7 text-center">Tap products to ring them up</div>
          )}
          {cartLines.map(l => (
            <div key={l.productId} className="py-2">
              <div className="flex justify-between gap-2 text-sm font-medium text-ink">
                <span>{l.product.name}</span>
                <span className="whitespace-nowrap">{money(l.line_total)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <button
                  className="size-6 rounded-full grid place-items-center bg-surface-2 text-ink transition-colors hover:bg-accent-tint hover:text-accent"
                  onClick={() => setQty(l.productId, l.qty - 1)}
                  aria-label="Decrease quantity"
                >
                  <Minus size={12} />
                </button>
                <span className="min-w-5 text-center font-bold text-sm">{l.qty}</span>
                <button
                  className="size-6 rounded-full grid place-items-center bg-surface-2 text-ink transition-colors hover:bg-accent-tint hover:text-accent"
                  onClick={() => setQty(l.productId, l.qty + 1)}
                  aria-label="Increase quantity"
                >
                  <Plus size={12} />
                </button>
                <span className="text-[11px] text-muted">@ {money(l.product.price)}</span>
                <button
                  className="ml-auto size-6 rounded-full grid place-items-center text-muted hover:text-red hover:bg-red-tint"
                  onClick={() => setQty(l.productId, 0)}
                  aria-label="Remove item"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <hr className="rc-rule" />
        <div className="rc-row text-ink">
          <span>Subtotal</span><span>{money(subtotal)}</span>
        </div>
        <div className="rc-row text-ink">
          <span>
            Discount{' '}
            <input
              className="w-11 border border-line rounded-[6px] text-xs text-right bg-surface-2 text-ink outline-none focus:border-accent px-1 py-0.5"
              style={{ fontFamily: 'inherit' }}
              type="number" min="0" max={maxDiscount} value={discountPct}
              onChange={e => setDiscountPct(Math.max(0, Math.min(maxDiscount, Number(e.target.value) || 0)))}
              title={`Up to ${maxDiscount}%`}
            />
            %{maxDiscount < 100 && <span className="text-[10.5px] text-muted ml-1">(max {maxDiscount}%)</span>}
          </span>
          <span>−{money(discountAmt)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold text-accent pt-1.5 pb-0.5">
          <span>TOTAL</span><span>{money(total)}</span>
        </div>
        <div className="flex justify-between text-muted text-[11.5px]">
          <span>VAT {settings.tax_rate}% (incl.)</span>
          <span>{money(vatIncluded.toFixed(2))}</span>
        </div>
        <div className="flex gap-2.5 pt-3.5 pb-4.5 font-sans">
          <Button variant="outline" size="lg" onClick={clearCart} disabled={!cartLines.length}>
            Clear
          </Button>
          <Button
            size="lg" className="flex-1"
            onClick={() => cartLines.length && setPayOpen(true)}
            disabled={!cartLines.length || checkingOut}
          >
            Charge {money(total)}
          </Button>
        </div>
      </aside>

      {payOpen && (
        <PaymentModal total={total} money={money} onClose={() => setPayOpen(false)} onComplete={completeSale} />
      )}
      {receipt && (
        <ReceiptModal sale={receipt} settings={settings} money={money} onClose={() => setReceipt(null)} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
