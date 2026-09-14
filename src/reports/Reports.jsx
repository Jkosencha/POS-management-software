import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import DayClose from './DayClose'

const PAY_METHODS = ['Cash', 'M-Pesa', 'Card']

const REASON_COLORS = {
  sale:       'var(--surface-3)',
  restock:    'var(--green)',
  return:     'var(--green-dark)',
  adjustment: 'var(--amber-warn)',
  spoilage:   'var(--red)',
}
const REASON_TEXT = {
  sale: 'var(--ink)', restock: '#fff', return: '#fff', adjustment: '#fff', spoilage: '#fff',
}

const toStr = d => d.toISOString().slice(0, 10)
const todayStr   = () => toStr(new Date())
const nDaysAgo   = n => { const d = new Date(); d.setDate(d.getDate() - n); return toStr(d) }
const startMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const startYear  = () => `${new Date().getFullYear()}-01-01`

const PRESETS = [
  { label: 'Today',       from: todayStr,       to: todayStr },
  { label: 'Yesterday',   from: () => nDaysAgo(1), to: () => nDaysAgo(1) },
  { label: 'Last 7 days', from: () => nDaysAgo(6), to: todayStr },
  { label: 'This month',  from: startMonth,     to: todayStr },
  { label: 'This year',   from: startYear,      to: todayStr },
]

function Stat({ label, value, accent, sub }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ReasonBadge({ reason }) {
  return (
    <span style={{
      background: REASON_COLORS[reason] || 'var(--line)',
      color: REASON_TEXT[reason] || 'var(--ink)',
      fontSize: 11, fontWeight: 700, borderRadius: 99,
      padding: '2px 8px', letterSpacing: '.04em', textTransform: 'uppercase',
    }}>
      {reason}
    </span>
  )
}

export default function Reports({ money, role }) {
  const [from, setFrom]     = useState(todayStr())
  const [to, setTo]         = useState(todayStr())
  const [preset, setPreset] = useState('Today')
  const [sales, setSales]   = useState([])
  const [movements, setMovements] = useState([])
  const [lowStock, setLowStock]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [movFilter, setMovFilter] = useState('all')
  const [dayCloseOpen, setDayCloseOpen] = useState(false)

  const canClose = role === 'manager' || role === 'owner'

  const fetchData = useCallback(async (f = from, t = to) => {
    setLoading(true)
    const fromTs = `${f}T00:00:00`
    const toTs   = `${t}T23:59:59`

    const [{ data: salesData }, { data: movData }, { data: stockData }] = await Promise.all([
      supabase
        .from('sales')
        .select('*, sale_items(*)')
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .eq('status', 'completed')           // exclude voided sales from stats
        .order('created_at', { ascending: false }),
      supabase
        .from('stock_movements')
        .select('*, products(name), profiles(full_name)')
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('products')
        .select('id, name, stock, low_at')
        .eq('active', true),
    ])

    setSales((salesData || []).map(s => ({ ...s, items: s.sale_items || [] })))
    setMovements(movData || [])
    setLowStock((stockData || []).filter(p => p.stock <= p.low_at))
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const ch = supabase
      .channel('reports-sales')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, () => fetchData())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchData])

  const applyPreset = (p) => {
    const f = p.from(); const t = p.to()
    setFrom(f); setTo(t); setPreset(p.label)
    fetchData(f, t)
  }

  const revenue   = sales.reduce((s, x) => s + Number(x.total), 0)
  const itemCount = sales.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0)
  const avg       = sales.length ? revenue / sales.length : 0

  // Profit is a lower bound: items sold before cost tracking was set up (or
  // never restocked with a cost) have no cost_price snapshot and count as $0
  // cost here, so margin can only be under- not over-stated.
  let cogs = 0
  let costedItemCount = 0
  sales.forEach(s => s.items.forEach(i => {
    if (i.cost_price != null) {
      cogs += Number(i.cost_price) * i.qty
      costedItemCount += i.qty
    }
  }))
  const profit    = revenue - cogs
  const margin    = revenue > 0 ? (profit / revenue * 100) : 0
  const hasCostGaps = itemCount > 0 && costedItemCount < itemCount

  const topMap = {}
  sales.forEach(s => s.items.forEach(i => {
    topMap[i.name] = topMap[i.name] || { name: i.name, qty: 0, revenue: 0 }
    topMap[i.name].qty += i.qty
    topMap[i.name].revenue += Number(i.line_total)
  }))
  const topProducts = Object.values(topMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8)

  const paySplit = Object.fromEntries(PAY_METHODS.map(m => [m, { count: 0, total: 0 }]))
  sales.forEach(s => { paySplit[s.method].count++; paySplit[s.method].total += Number(s.total) })

  const filteredMov = movFilter === 'all' ? movements : movements.filter(m => m.reason === movFilter)
  const isToday     = from === todayStr() && to === todayStr()

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <header className="page-head">
        <h1>
          Reports
          {isToday && (
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: 'var(--green)', verticalAlign: 'middle' }}>
              ● live
            </span>
          )}
        </h1>
        {canClose && (
          <button className="btn secondary" onClick={() => setDayCloseOpen(true)}>
            Close day
          </button>
        )}
      </header>

      {/* date range picker */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            className={`cat ${preset === p.label ? 'on' : ''}`}
            style={{ margin: 0 }}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
          <input
            type="date" value={from} max={to}
            onChange={e => { setFrom(e.target.value); setPreset('Custom') }}
            style={{ padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }}
          />
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>→</span>
          <input
            type="date" value={to} min={from} max={todayStr()}
            onChange={e => { setTo(e.target.value); setPreset('Custom') }}
            style={{ padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }}
          />
          {preset === 'Custom' && (
            <button className="btn pay" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => fetchData()}>
              Apply
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="Revenue" value={money(revenue)} accent sub={`${sales.length} sale${sales.length === 1 ? '' : 's'}`} />
            <Stat
              label="Profit"
              value={money(Math.round(profit))}
              sub={revenue > 0 ? `${margin.toFixed(1)}% margin${hasCostGaps ? ' · partial' : ''}` : undefined}
            />
            <Stat label="Items sold" value={itemCount} />
            <Stat label="Avg. basket" value={money(Math.round(avg))} />
            <Stat label="Low stock" value={lowStock.length} />
          </div>
          {hasCostGaps && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -8, marginBottom: 14 }}>
              Profit is a lower bound — some items sold have no recorded cost price yet.
              Set one in Inventory or on the next restock to sharpen this number.
            </p>
          )}

          <div className="report-cols" style={{ marginTop: 14 }}>
            <section className="card">
              <h2>Top sellers</h2>
              {topProducts.length === 0 && <p className="muted">No sales in this period.</p>}
              {topProducts.map(t => (
                <div className="rc-row" key={t.name}>
                  <span>{t.name} <span className="muted">× {t.qty}</span></span>
                  <span>{money(t.revenue)}</span>
                </div>
              ))}
            </section>

            <section className="card">
              <h2>Payment split</h2>
              {PAY_METHODS.map(m => (
                <div className="rc-row" key={m} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>{m}</span>
                    <span>{money(paySplit[m].total)}</span>
                  </div>
                  {paySplit[m].total > 0 && revenue > 0 && (
                    <div className="pay-bar-wrap" style={{ width: '100%' }}>
                      <div
                        className="pay-bar"
                        style={{ width: `${(paySplit[m].total / revenue * 100).toFixed(1)}%` }}
                      />
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{paySplit[m].count} sale{paySplit[m].count === 1 ? '' : 's'}</span>
                </div>
              ))}
            </section>

            <section className="card">
              <h2>Low stock ({lowStock.length})</h2>
              {lowStock.length === 0 && <p className="muted">All stocked up. ✓</p>}
              {lowStock.map(p => (
                <div className="rc-row" key={p.id}>
                  <span>{p.name}</span>
                  <span className="stock-low">{p.stock} left</span>
                </div>
              ))}
            </section>
          </div>

          {/* stock movement audit */}
          <section style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                Stock movements ({movements.length})
              </h2>
              <div style={{ display: 'flex', gap: 6 }}>
                {['all', 'restock', 'sale', 'adjustment', 'spoilage', 'return'].map(r => (
                  <button
                    key={r}
                    className={`cat ${movFilter === r ? 'on' : ''}`}
                    style={{ margin: 0, fontSize: 12, padding: '4px 11px' }}
                    onClick={() => setMovFilter(r)}
                  >
                    {r === 'all' ? 'All' : r}
                  </button>
                ))}
              </div>
            </div>

            <div className="table">
              <div className="tr th" style={{ gridTemplateColumns: '1.4fr 2fr 1fr .6fr 1.8fr 1fr' }}>
                <span>Time</span><span>Product</span><span>Reason</span>
                <span className="num">Qty</span><span>Note</span><span>By</span>
              </div>
              {filteredMov.length === 0 && (
                <div className="empty-grid">No movements in this period.</div>
              )}
              {filteredMov.map(m => (
                <div className="tr" key={m.id} style={{ gridTemplateColumns: '1.4fr 2fr 1fr .6fr 1.8fr 1fr', fontSize: 13 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {new Date(m.created_at).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>{m.products?.name || '—'}</span>
                  <span><ReasonBadge reason={m.reason} /></span>
                  <span className="num" style={{ color: m.qty_change > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {m.qty_change > 0 ? '+' : ''}{m.qty_change}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.note || '—'}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.profiles?.full_name || '—'}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {dayCloseOpen && <DayClose money={money} onClose={() => setDayCloseOpen(false)} />}
    </div>
  )
}
