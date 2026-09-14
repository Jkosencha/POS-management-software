import React, { useState, useEffect, useCallback } from 'react'
import { Wallet, ShoppingBasket, Smartphone, PackageX, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'
import DayClose from '../reports/DayClose'
import SalesChart from './SalesChart'
import PaymentDonut from './PaymentDonut'

const METHOD_COLOR = {
  Cash:     'var(--accent)',
  'M-Pesa': 'var(--green)',
  Card:     '#5b8dee',
}

const STAT_CARD_BASE = 'relative overflow-hidden rounded-lg p-5 pb-5.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md'
const STAT_ICON = 'w-8.5 h-8.5 rounded-[10px] flex items-center justify-center mb-4 bg-white/60'

function Spark({ bars, colorClass }) {
  return (
    <div className={`absolute top-4.5 right-4.5 w-8.5 h-5 flex items-end gap-0.5 opacity-50 ${colorClass}`}>
      {bars.map((h, i) => <span key={i} className="flex-1 rounded-t-sm bg-current" style={{ height: `${h}%` }} />)}
    </div>
  )
}

export default function Dashboard({ money, role, onNavigate }) {
  const { profile } = useSession()
  const [todaySales, setTodaySales]   = useState([])
  const [products, setProducts]       = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [loading, setLoading]         = useState(true)
  const [dayCloseOpen, setDayCloseOpen] = useState(false)

  const fetchData = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const [{ data: salesData }, { data: prodData }] = await Promise.all([
      supabase
        .from('sales')
        .select('id, receipt_no, method, total, created_at, profiles:cashier_id(full_name)')
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .eq('status', 'completed')
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('id, name, stock, low_at')
        .eq('active', true)
        .order('stock', { ascending: true }),
    ])

    const sales = salesData || []
    setTodaySales(sales)
    setProducts(prodData || [])

    // Build top products from today's sale_items
    if (sales.length > 0) {
      const { data: items } = await supabase
        .from('sale_items')
        .select('product_id, qty, price, products:product_id(name)')
        .in('sale_id', sales.map(s => s.id))

      const map = {}
      ;(items || []).forEach(item => {
        const id = item.product_id
        if (!map[id]) map[id] = { name: item.products?.name || '?', revenue: 0, qty: 0 }
        map[id].revenue += Number(item.price) * item.qty
        map[id].qty     += item.qty
      })
      setTopProducts(Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 6))
    } else {
      setTopProducts([])
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime: push new sale to the top, then refresh for accurate top-products
  useEffect(() => {
    const ch = supabase
      .channel('dashboard-sales')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, payload => {
        setTodaySales(prev => [{ ...payload.new, profiles: null }, ...prev])
        fetchData()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchData])

  /* ---- derived ---- */
  const revenue  = todaySales.reduce((n, s) => n + Number(s.total), 0)
  const avg      = todaySales.length ? revenue / todaySales.length : 0
  const mpesa    = todaySales.filter(s => s.method === 'M-Pesa').reduce((n, s) => n + Number(s.total), 0)
  const lowStock = products.filter(p => p.stock <= p.low_at)

  const paySplit = { Cash: 0, 'M-Pesa': 0, Card: 0 }
  todaySales.forEach(s => { paySplit[s.method] = (paySplit[s.method] || 0) + Number(s.total) })

  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (profile?.full_name || 'there').split(' ')[0]
  const canClose  = role === 'manager' || role === 'owner'

  const maxProductRevenue = topProducts[0]?.revenue || 1

  return (
    <div className="px-4 py-4 sm:px-9 sm:py-8 max-w-300">

      {/* ---- welcome header ---- */}
      <div className="flex justify-between items-start mb-7">
        <div>
          <h1 className="font-serif text-[28px] sm:text-[40px] font-semibold tracking-tight text-ink mb-1.5 leading-[1.1]">
            {greeting}, {firstName}
            <span className="inline-block ml-3.5 text-[11px] font-bold text-green align-middle font-sans tracking-wide">● live</span>
          </h1>
          <div className="text-sm text-muted font-sans">
            {new Date().toLocaleDateString('en-KE', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </div>
        </div>
        {canClose && (
          <button className="btn secondary" onClick={() => setDayCloseOpen(true)}>
            Close day
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {/* ---- stat cards ---- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
            <div className={`${STAT_CARD_BASE} bg-mint-bg text-mint-fg`}>
              <div className={STAT_ICON}><Wallet size={17} /></div>
              <Spark bars={[40, 65, 50, 85, 100]} colorClass="text-mint-fg" />
              <div className="text-[11.5px] font-bold text-ink-2 mb-2.5">Today's revenue</div>
              <div className="font-mono text-[28px] font-bold text-ink leading-none">{money(revenue)}</div>
              <div className="text-xs text-ink-2/70 mt-1.5">{todaySales.length} sale{todaySales.length !== 1 ? 's' : ''}</div>
            </div>
            <div className={`${STAT_CARD_BASE} bg-teal-bg text-teal-fg`}>
              <div className={STAT_ICON}><ShoppingBasket size={17} /></div>
              <Spark bars={[60, 40, 90, 55, 70]} colorClass="text-teal-fg" />
              <div className="text-[11.5px] font-bold text-ink-2 mb-2.5">Avg. basket</div>
              <div className="font-mono text-[28px] font-bold text-ink leading-none">{money(Math.round(avg))}</div>
            </div>
            <div className={`${STAT_CARD_BASE} bg-lavender-bg text-lavender-fg`}>
              <div className={STAT_ICON}><Smartphone size={17} /></div>
              <Spark bars={[50, 80, 35, 95, 60]} colorClass="text-lavender-fg" />
              <div className="text-[11.5px] font-bold text-ink-2 mb-2.5">M-Pesa today</div>
              <div className="font-mono text-[28px] font-bold text-ink leading-none">{money(mpesa)}</div>
            </div>
            <div className={`${STAT_CARD_BASE} ${lowStock.length > 0 ? 'bg-coral-bg text-coral-fg' : 'bg-teal-bg text-teal-fg'}`}>
              <div className={STAT_ICON}><PackageX size={17} /></div>
              <Spark bars={[80, 55, 30, 15, 10]} colorClass={lowStock.length > 0 ? 'text-coral-fg' : 'text-teal-fg'} />
              <div className="text-[11.5px] font-bold text-ink-2 mb-2.5">Low stock</div>
              <div className="font-mono text-[28px] font-bold text-ink leading-none">{lowStock.length}</div>
              {lowStock.length > 0 && (
                <button
                  className="inline-flex items-center gap-1 mt-2 bg-transparent border-0 p-0 text-xs font-bold cursor-pointer text-inherit hover:underline"
                  onClick={() => onNavigate('inventory')}
                >
                  View inventory <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>

          {/* ---- Revenue trend chart ---- */}
          <div className="dash-card mb-3.5">
            <SalesChart />
          </div>

          {/* ---- main grid ---- */}
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-3.5 lg:items-start">

            {/* Live sales table */}
            <div className="dash-card lg:col-span-2">
              <div className="dash-card-head">
                <h3>Live sales today</h3>
                <button className="link" onClick={() => onNavigate('sales')}>Full history →</button>
              </div>
              {todaySales.length === 0 ? (
                <p className="text-muted text-center text-sm py-6">
                  No sales yet today.
                </p>
              ) : (
                <div>
                  <div className="grid grid-cols-[1fr_1.2fr_1fr_.9fr] gap-2 py-1.5 pb-2 text-[10.5px] font-bold tracking-[.09em] uppercase text-muted border-b-[1.5px] border-line">
                    <span>Receipt</span>
                    <span>Cashier</span>
                    <span>Method</span>
                    <span className="text-right">Total</span>
                  </div>
                  {todaySales.map(s => (
                    <div key={s.id} className="grid grid-cols-[1fr_1.2fr_1fr_.9fr] gap-2 py-2.5 border-b border-line items-center last:border-b-0 hover:bg-surface-2 transition-colors">
                      <span className="font-mono text-xs">{s.receipt_no}</span>
                      <span className="text-muted text-xs">{s.profiles?.full_name || '—'}</span>
                      <span>
                        <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 tracking-wide inline-block" style={{
                          background: `${METHOD_COLOR[s.method]}1a`,
                          color: METHOD_COLOR[s.method],
                        }}>
                          {s.method}
                        </span>
                      </span>
                      <span className="text-right font-mono font-bold text-[13px]">
                        {money(s.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-3.5">

              {/* Stock alerts */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <h3>Stock alerts</h3>
                  <button className="link" onClick={() => onNavigate('inventory')}>Restock →</button>
                </div>
                {lowStock.length === 0 ? (
                  <p className="text-green text-sm font-semibold m-0">
                    All items stocked ✓
                  </p>
                ) : (
                  lowStock.slice(0, 7).map(p => (
                    <div key={p.id} className="flex justify-between items-center py-2 border-b border-line text-sm last:border-b-0">
                      <span>{p.name}</span>
                      <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-amber'}`}>
                        {p.stock === 0 ? 'Out' : `${p.stock} left`}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Payment split */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <h3>Payment split</h3>
                </div>
                {revenue === 0 ? (
                  <p className="text-muted text-sm m-0">No sales yet today.</p>
                ) : (
                  <PaymentDonut paySplit={paySplit} revenue={revenue} money={money} />
                )}
              </div>

              {/* Top products today */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <h3>Top products today</h3>
                </div>
                {topProducts.length === 0 ? (
                  <p className="text-muted text-sm m-0">No sales yet today.</p>
                ) : (
                  topProducts.map((p, i) => {
                    const pct = (p.revenue / maxProductRevenue * 100).toFixed(0)
                    return (
                      <div key={i} className={i < topProducts.length - 1 ? 'mb-3.5' : ''}>
                        <div className="flex justify-between mb-1 text-sm">
                          <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-[58%]">
                            {p.name}
                          </span>
                          <span className="font-mono font-bold text-xs text-accent">
                            {money(p.revenue)}
                          </span>
                        </div>
                        <div className="pay-bar-wrap">
                          <div className="pay-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {p.qty} unit{p.qty !== 1 ? 's' : ''} sold
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {dayCloseOpen && <DayClose money={money} onClose={() => setDayCloseOpen(false)} />}
    </div>
  )
}
