import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'
import DayClose from '../reports/DayClose'
import SalesChart from './SalesChart'

const METHOD_COLOR = {
  Cash:     'var(--accent)',
  'M-Pesa': 'var(--green)',
  Card:     '#5b8dee',
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
    <div className="dashboard">

      {/* ---- welcome header ---- */}
      <div className="dash-header">
        <div>
          <h1 className="dash-greeting">
            {greeting}, {firstName}
            <span className="dash-live">● live</span>
          </h1>
          <div className="dash-date">
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
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          {/* ---- stat cards ---- */}
          <div className="dash-stats">
            <div className="dash-stat accent">
              <div className="dash-stat-label">Today's revenue</div>
              <div className="dash-stat-value">{money(revenue)}</div>
              <div className="dash-stat-sub">{todaySales.length} sale{todaySales.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-label">Avg. basket</div>
              <div className="dash-stat-value">{money(Math.round(avg))}</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-label">M-Pesa today</div>
              <div className="dash-stat-value">{money(mpesa)}</div>
            </div>
            <div className={`dash-stat ${lowStock.length > 0 ? 'warn' : ''}`}>
              <div className="dash-stat-label">Low stock</div>
              <div className="dash-stat-value">{lowStock.length}</div>
              {lowStock.length > 0 && (
                <button className="dash-stat-action" onClick={() => onNavigate('inventory')}>
                  View inventory →
                </button>
              )}
            </div>
          </div>

          {/* ---- main grid ---- */}
          <div className="dash-grid">

            {/* Live sales table */}
            <div className="dash-card">
              <div className="dash-card-head">
                <h3>Live sales today</h3>
                <button className="link" onClick={() => onNavigate('sales')}>Full history →</button>
              </div>
              {todaySales.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0', textAlign: 'center', fontSize: 14 }}>
                  No sales yet today.
                </p>
              ) : (
                <div>
                  <div className="dash-table-head">
                    <span>Receipt</span>
                    <span>Cashier</span>
                    <span>Method</span>
                    <span style={{ textAlign: 'right' }}>Total</span>
                  </div>
                  {todaySales.map(s => (
                    <div key={s.id} className="dash-table-row">
                      <span className="mono" style={{ fontSize: 12 }}>{s.receipt_no}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{s.profiles?.full_name || '—'}</span>
                      <span>
                        <span className="dash-method-badge" style={{
                          background: `${METHOD_COLOR[s.method]}1a`,
                          color: METHOD_COLOR[s.method],
                        }}>
                          {s.method}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>
                        {money(s.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="dash-col">

              {/* Stock alerts */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <h3>Stock alerts</h3>
                  <button className="link" onClick={() => onNavigate('inventory')}>Restock →</button>
                </div>
                {lowStock.length === 0 ? (
                  <p style={{ color: 'var(--green)', fontSize: 13, fontWeight: 600, margin: 0 }}>
                    All items stocked ✓
                  </p>
                ) : (
                  lowStock.slice(0, 7).map(p => (
                    <div key={p.id} className="dash-stock-row">
                      <span style={{ fontSize: 13 }}>{p.name}</span>
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
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No sales yet today.</p>
                ) : (
                  ['Cash', 'M-Pesa', 'Card'].map(m => {
                    const pct = revenue > 0 ? (paySplit[m] / revenue * 100).toFixed(0) : 0
                    return (
                      <div key={m} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                          <span>{m}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12 }}>
                            {pct}% · {money(paySplit[m])}
                          </span>
                        </div>
                        <div className="pay-bar-wrap">
                          <div className="pay-bar" style={{ width: `${pct}%`, background: METHOD_COLOR[m] }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Top products today */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <h3>Top products today</h3>
                </div>
                {topProducts.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No sales yet today.</p>
                ) : (
                  topProducts.map((p, i) => {
                    const pct = (p.revenue / maxProductRevenue * 100).toFixed(0)
                    return (
                      <div key={i} style={{ marginBottom: i < topProducts.length - 1 ? 13 : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                          <span style={{
                            fontWeight: 600, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58%',
                          }}>
                            {p.name}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>
                            {money(p.revenue)}
                          </span>
                        </div>
                        <div className="pay-bar-wrap">
                          <div className="pay-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {p.qty} unit{p.qty !== 1 ? 's' : ''} sold
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

            </div>
          </div>

          {/* ---- Revenue trend chart ---- */}
          <div className="dash-card" style={{ marginTop: 14 }}>
            <SalesChart />
          </div>
        </>
      )}

      {dayCloseOpen && <DayClose money={money} onClose={() => setDayCloseOpen(false)} />}
    </div>
  )
}
