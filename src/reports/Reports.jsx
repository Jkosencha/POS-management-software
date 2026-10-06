import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { todayKey as todayStr, daysAgoKey as nDaysAgo, pad2, startOfDay, startOfNextDay } from '../lib/dates'
import DayClose from './DayClose'
import ZReportView from './ZReportView'
import ReasonBadge from '../components/ReasonBadge'
import DonutChart from '../dashboard/DonutChart'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const PAY_METHODS = ['Cash', 'M-Pesa', 'Card']
const METHOD_COLOR = { Cash: 'var(--chart-1)', 'M-Pesa': 'var(--chart-3)', Card: 'var(--chart-2)' }

const startMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01` }
const startYear  = () => `${new Date().getFullYear()}-01-01`

const PRESETS = [
  { label: 'Today',       from: todayStr,       to: todayStr },
  { label: 'Yesterday',   from: () => nDaysAgo(1), to: () => nDaysAgo(1) },
  { label: 'Last 7 days', from: () => nDaysAgo(6), to: todayStr },
  { label: 'This month',  from: startMonth,     to: todayStr },
  { label: 'This year',   from: startYear,      to: todayStr },
]

function Stat({ label, value, sub, colorClass = 'bg-surface' }) {
  return (
    <div className={`rounded-lg p-4.5 shadow-sm ${colorClass}`}>
      <div className="text-[12.5px] font-semibold text-ink-2">{label}</div>
      <div className="font-bold text-[22px] mt-2 text-ink leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
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
  const [partnerRows, setPartnerRows]   = useState([])
  const [dayCloses, setDayCloses]       = useState([])
  const [viewClose, setViewClose]       = useState(null)

  const canClose = role === 'manager' || role === 'owner'

  const fetchData = useCallback(async (f = from, t = to) => {
    setLoading(true)
    const fromTs = startOfDay(f).toISOString()
    const toTs   = startOfNextDay(t).toISOString()

    const [{ data: salesData }, { data: movData }, { data: stockData }, { data: closeData }] = await Promise.all([
      fetchAll(() => supabase
        .from('sales')
        .select('*, sale_items(*)')
        .gte('created_at', fromTs)
        .lt('created_at', toTs)
        .eq('status', 'completed')           // exclude voided sales from stats
        .order('created_at', { ascending: false })
        .order('id')),
      supabase
        .from('stock_movements')
        .select('*, products(name), profiles(full_name)')
        .gte('created_at', fromTs)
        .lt('created_at', toTs)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('products')
        .select('id, name, stock, low_at')
        .eq('active', true),
      supabase
        .from('day_closes')
        // closed_by points at auth.users, not profiles, so it can't be
        // embedded; names are looked up below
        .select('*')
        .gte('period_start', fromTs)
        .lt('period_start', toTs)
        .order('period_start', { ascending: false }),
    ])
    const closes = closeData || []
    const closerIds = [...new Set(closes.map(d => d.closed_by).filter(Boolean))]
    if (closerIds.length) {
      const { data: names } = await supabase.from('profiles').select('id, full_name').in('id', closerIds)
      const byId = Object.fromEntries((names || []).map(p => [p.id, p.full_name]))
      closes.forEach(d => { d.closer_name = byId[d.closed_by] })
    }
    setDayCloses(closes)

    const { data: partnerData } = await supabase.rpc('partner_summary', { p_from: fromTs, p_to: toTs })
    setPartnerRows(partnerData || [])

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

  const payData = PAY_METHODS.map(m => ({ name: m, value: paySplit[m].total, color: METHOD_COLOR[m] }))

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <header className="page-head">
        <h1>
          Reports
          {isToday && (
            <span className="ml-2.5 text-xs font-semibold text-green align-middle">● live</span>
          )}
        </h1>
        {canClose && (
          <Button variant="outline" onClick={() => setDayCloseOpen(true)}>Close day</Button>
        )}
      </header>

      {/* date range picker */}
      <div className="flex gap-2 flex-wrap items-center mb-5">
        {PRESETS.map(p => (
          <button
            key={p.label}
            className={`cat ${preset === p.label ? 'on' : ''}`}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
        <div className="flex gap-1.5 items-center sm:ml-1">
          <input
            type="date" value={from} max={to}
            onChange={e => { setFrom(e.target.value); setPreset('Custom') }}
            className="h-8 px-3 rounded-full border border-line bg-surface text-ink text-[13px]"
          />
          <span className="text-muted text-[13px]">to</span>
          <input
            type="date" value={to} min={from} max={todayStr()}
            onChange={e => { setTo(e.target.value); setPreset('Custom') }}
            className="h-8 px-3 rounded-full border border-line bg-surface text-ink text-[13px]"
          />
          {preset === 'Custom' && (
            <Button size="sm" onClick={() => fetchData()}>Apply</Button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="Revenue" value={money(revenue)} colorClass="bg-mint-bg" sub={`${sales.length} sale${sales.length === 1 ? '' : 's'}`} />
            <Stat
              label="Profit"
              value={money(Math.round(profit))}
              colorClass="bg-lavender-bg"
              sub={revenue > 0 ? `${margin.toFixed(1)}% margin${hasCostGaps ? ' · partial' : ''}` : undefined}
            />
            <Stat label="Items sold" value={itemCount} colorClass="bg-teal-bg" />
            <Stat label="Avg. basket" value={money(Math.round(avg))} />
            <Stat label="Low stock" value={lowStock.length} colorClass={lowStock.length > 0 ? 'bg-coral-bg' : 'bg-surface'} />
          </div>
          {hasCostGaps && (
            <p className="text-xs text-muted mt-2.5 mb-0">
              Profit is a lower bound: some items sold have no recorded buying price yet.
              Set one in Inventory or on the next restock to sharpen this number.
            </p>
          )}

          {partnerRows.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {partnerRows.map(r => {
                const rev  = Number(r.own_revenue) + Number(r.shared_revenue)
                const cost = Number(r.own_cost) + Number(r.shared_cost)
                const pct  = revenue > 0 ? Math.round(rev / revenue * 100) : 0
                return (
                  <div key={r.partner_id} className="rounded-lg bg-surface shadow-sm p-4" style={{ boxShadow: `inset 4px 0 0 ${r.color}, var(--shadow-sm)` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="size-2.5 rounded-full" style={{ background: r.color }} />{r.name}
                      </span>
                      <span className="text-xs font-semibold text-muted">{pct}% of revenue</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-2">
                      <span className="text-xl font-bold">{money(Math.round(rev))}</span>
                      <span className={`text-sm font-semibold ${rev - cost < 0 ? 'text-red' : 'text-green'}`}>
                        {money(Math.round(rev - cost))} profit
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-2 mt-2.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="report-cols mt-4">
            <section className="card">
              <h2>Top sellers</h2>
              {topProducts.length === 0 && <p className="muted text-sm">No sales in this period.</p>}
              {topProducts.map(t => (
                <div className="rc-row" key={t.name}>
                  <span className="truncate pr-2">{t.name} <span className="muted">× {t.qty}</span></span>
                  <span className="font-mono shrink-0">{money(t.revenue)}</span>
                </div>
              ))}
            </section>

            <section className="card">
              <h2>Payment split</h2>
              {revenue === 0
                ? <p className="muted text-sm">No sales in this period.</p>
                : <DonutChart data={payData} money={money} centerLabel={`${sales.length} sales`} height={180} />}
            </section>

            <section className="card">
              <h2>Low stock ({lowStock.length})</h2>
              {lowStock.length === 0 && <p className="text-green text-sm font-semibold">All stocked up.</p>}
              {lowStock.map(p => (
                <div className="rc-row" key={p.id}>
                  <span className="text-red font-semibold truncate pr-2">{p.name}</span>
                  <span className="text-red font-bold shrink-0">{p.stock} left</span>
                </div>
              ))}
            </section>
          </div>

          {/* stock movement audit */}
          <section className="mt-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
              <h2 className="m-0 text-base font-bold">
                Stock movements ({movements.length === 200 ? 'latest 200' : movements.length})
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {['all', 'restock', 'sale', 'adjustment', 'spoilage', 'return'].map(r => (
                  <button
                    key={r}
                    className={`cat capitalize ${movFilter === r ? 'on' : ''}`}
                    onClick={() => setMovFilter(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Time</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="max-md:hidden">Note</TableHead>
                    <TableHead className="max-md:hidden">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMov.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="empty-grid">No movements in this period.</TableCell>
                    </TableRow>
                  )}
                  {filteredMov.map(m => (
                    <TableRow key={m.id} className="text-[13px]">
                      <TableCell className="mono text-xs text-ink-2">
                        {new Date(m.created_at).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell className="font-medium">{m.products?.name || '-'}</TableCell>
                      <TableCell><ReasonBadge reason={m.reason} /></TableCell>
                      <TableCell className={`num font-bold ${m.qty_change > 0 ? 'text-green' : 'text-red'}`}>
                        {m.qty_change > 0 ? '+' : ''}{m.qty_change}
                      </TableCell>
                      <TableCell className="text-muted text-xs max-md:hidden whitespace-normal">{m.note || '-'}</TableCell>
                      <TableCell className="text-muted text-xs max-md:hidden">{m.profiles?.full_name || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      {/* saved Z-reports */}
      {!loading && (
        <section className="mt-6">
          <h2 className="m-0 mb-1 text-base font-bold">Day closes ({dayCloses.length})</h2>
          <p className="text-xs text-muted mt-0 mb-3">Click a row to open the full Z-report.</p>
          <div className="table-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right max-md:hidden">Cash</TableHead>
                  <TableHead className="text-right max-md:hidden">M-Pesa</TableHead>
                  <TableHead className="text-right">Expected cash</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="max-lg:hidden">Closed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayCloses.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="empty-grid">No days closed in this period.</TableCell>
                  </TableRow>
                )}
                {dayCloses.map(d => {
                  const v = d.variance == null ? null : Number(d.variance)
                  return (
                    <TableRow
                      key={d.id}
                      className="text-[13px] cursor-pointer"
                      onClick={() => setViewClose(d)}
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setViewClose(d) }}
                    >
                      <TableCell className="font-medium">
                        {new Date(d.period_start).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
                        <div className="text-[11px] text-muted font-normal">
                          closed {new Date(d.closed_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {d.notes && <div className="text-xs text-muted font-normal whitespace-normal">{d.notes}</div>}
                      </TableCell>
                      <TableCell className="num">{money(d.total_sales)}</TableCell>
                      <TableCell className="num max-md:hidden">{money(d.cash_sales)}</TableCell>
                      <TableCell className="num max-md:hidden">{money(d.mpesa_sales)}</TableCell>
                      <TableCell className="num">{money(d.expected_cash)}</TableCell>
                      <TableCell className="num">{d.actual_cash == null ? '-' : money(d.actual_cash)}</TableCell>
                      <TableCell className={`num font-bold ${v == null ? 'text-muted' : v === 0 ? 'text-green' : v > 0 ? 'text-amber-warn' : 'text-red'}`}>
                        {v == null ? '-' : `${v > 0 ? '+' : ''}${money(v)}`}
                      </TableCell>
                      <TableCell className="text-muted text-xs max-lg:hidden">{d.closer_name || '-'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {viewClose && (
        <ZReportView
          report={viewClose}
          money={money}
          canDelete={role === 'owner'}
          onClose={() => setViewClose(null)}
          onDeleted={() => { setViewClose(null); fetchData() }}
        />
      )}

      {dayCloseOpen && <DayClose money={money} onClose={() => { setDayCloseOpen(false); fetchData() }} />}
    </div>
  )
}
