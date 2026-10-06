import React, { useState, useEffect, useCallback } from 'react'
import { Wallet, ShoppingBasket, Smartphone, PackageX, ArrowUpRight, Banknote, CreditCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import SalesChart from './SalesChart'
import DonutChart from './DonutChart'
import CategoryBreakdown from './CategoryBreakdown'
import PartnerSplit from './PartnerSplit'

const METHOD_STYLE = {
  Cash:     { icon: Banknote,   className: 'bg-mint-bg text-mint-fg' },
  'M-Pesa': { icon: Smartphone, className: 'bg-teal-bg text-teal-fg' },
  Card:     { icon: CreditCard, className: 'bg-lavender-bg text-lavender-fg' },
}

const METHOD_COLOR = {
  Cash:     'var(--chart-1)',
  'M-Pesa': 'var(--chart-3)',
  Card:     'var(--chart-2)',
}

function StatCard({ icon: Icon, label, value, sub, colorClass, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={`group relative text-left rounded-lg p-4.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${colorClass}`}
    >
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="size-8 rounded-full grid place-items-center bg-surface/70"><Icon size={15} /></span>
          <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        </div>
        <span className="size-7 rounded-full grid place-items-center border border-current/30 opacity-70 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight size={14} />
        </span>
      </div>
      <div className="font-bold text-[26px] text-ink leading-none tracking-tight">{value}</div>
      {sub && <div className="text-xs font-medium mt-2 opacity-90">{sub}</div>}
    </Comp>
  )
}

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`dash-card ${className}`}>
      {(title || action) && (
        <div className="dash-card-head">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// Cashiers see the same dashboard scoped to their own sales: RLS only returns
// sales they rang up, and cost/profit/partner figures are hidden.
export default function Dashboard({ money, onNavigate, role }) {
  const isAdmin = role === 'manager' || role === 'owner'
  const [todaySales, setTodaySales]   = useState([])
  const [products, setProducts]       = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [loading, setLoading]         = useState(true)

  const fetchData = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const [{ data: salesData }, { data: prodData }] = await Promise.all([
      supabase
        .from('sales')
        .select('id, receipt_no, method, total, created_at, profiles:cashier_id(full_name)')
        .gte('created_at', start.toISOString())
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
        .select('product_id, name, qty, line_total')
        .in('sale_id', sales.map(s => s.id))

      const map = {}
      ;(items || []).forEach(item => {
        const id = item.product_id ?? item.name
        if (!map[id]) map[id] = { name: item.name, revenue: 0, qty: 0 }
        map[id].revenue += Number(item.line_total)
        map[id].qty     += item.qty
      })
      setTopProducts(Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5))
    } else {
      setTopProducts([])
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime: refresh on every new sale
  useEffect(() => {
    const ch = supabase
      .channel('dashboard-sales')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, () => fetchData())
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
  const payData = Object.entries(paySplit).map(([name, value]) => ({ name, value, color: METHOD_COLOR[name] }))

  const maxProductRevenue = topProducts[0]?.revenue || 1

  if (loading) return <div className="p-6 text-muted">Loading...</div>

  return (
    <div className="p-3 sm:p-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px] items-start">

      {/* ================= main column ================= */}
      <div className="grid gap-4 min-w-0">
        {!isAdmin && (
          <div className="text-sm text-ink-2 -mb-1">
            Your sales today. Only sales you rang up are shown here.
          </div>
        )}
        {/* stat cards (pastel colors kept) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Wallet} label={isAdmin ? 'Revenue' : 'My revenue'} value={money(revenue)}
            sub={`${todaySales.length} sale${todaySales.length !== 1 ? 's' : ''} today`}
            colorClass="bg-mint-bg text-mint-fg"
            onClick={() => onNavigate('sales')}
          />
          <StatCard
            icon={ShoppingBasket} label="Avg. basket" value={money(Math.round(avg))}
            sub="per sale today"
            colorClass="bg-teal-bg text-teal-fg"
            onClick={isAdmin ? () => onNavigate('reports') : undefined}
          />
          <StatCard
            icon={Smartphone} label="M-Pesa" value={money(mpesa)}
            sub={revenue > 0 ? `${Math.round(mpesa / revenue * 100)}% of today` : 'today'}
            colorClass="bg-lavender-bg text-lavender-fg"
            onClick={() => onNavigate('sales')}
          />
          <StatCard
            icon={PackageX} label="Low stock" value={lowStock.length}
            sub={lowStock.length > 0 ? 'View inventory' : 'All items stocked'}
            colorClass={lowStock.length > 0 ? 'bg-coral-bg text-coral-fg' : 'bg-teal-bg text-teal-fg'}
            onClick={isAdmin ? () => onNavigate('inventory') : () => onNavigate('register')}
          />
        </div>

        <Card>
          <SalesChart money={money} showCost={isAdmin} />
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title={isAdmin ? 'Top products today' : 'My top products today'}
            action={isAdmin && <button className="link" onClick={() => onNavigate('reports')}>Reports</button>}
          >
            {topProducts.length === 0 ? (
              <p className="text-muted text-sm m-0">No sales yet today.</p>
            ) : (
              topProducts.map((p, i) => (
                <div key={i} className={i < topProducts.length - 1 ? 'mb-4' : ''}>
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="font-semibold truncate">{p.name}</span>
                    <span className="font-mono font-semibold text-ink-2 shrink-0">{money(p.revenue)}</span>
                  </div>
                  <div className="pay-bar-wrap">
                    <div className="pay-bar" style={{ width: `${Math.max(4, p.revenue / maxProductRevenue * 100)}%` }} />
                  </div>
                  <div className="text-[11px] text-muted">{p.qty} unit{p.qty !== 1 ? 's' : ''} sold</div>
                </div>
              ))
            )}
          </Card>

          <Card
            title="Stock alerts"
            action={isAdmin && <button className="link" onClick={() => onNavigate('inventory')}>Restock</button>}
          >
            {lowStock.length === 0 ? (
              <p className="text-green text-sm font-semibold m-0">All items stocked</p>
            ) : (
              lowStock.slice(0, 6).map(p => {
                const pct = p.low_at > 0 ? Math.min(100, p.stock / (p.low_at * 2) * 100) : 0
                return (
                  <div key={p.id} className="mb-3.5 last:mb-0">
                    <div className="flex justify-between items-center gap-2 text-[13px]">
                      <span className="font-semibold text-red truncate">{p.name}</span>
                      <span className={`badge ${p.stock === 0 ? 'badge-red' : 'badge-amber'}`}>
                        {p.stock === 0 ? 'Out' : `${p.stock} left`}
                      </span>
                    </div>
                    <div className="h-1.5 mt-1.5 rounded-full bg-red-tint overflow-hidden">
                      <div className="h-full rounded-full bg-red" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })
            )}
          </Card>
        </div>
      </div>

      {/* ================= right column ================= */}
      <div className="grid gap-4 min-w-0 md:grid-cols-2 xl:grid-cols-1">
        <Card
          title={isAdmin ? 'Recent sales' : 'My recent sales'}
          action={<button className="link" onClick={() => onNavigate('sales')}>View all</button>}
          className="md:col-span-2 xl:col-span-1"
        >
          {todaySales.length === 0 ? (
            <p className="text-muted text-sm m-0 py-4 text-center">No sales yet today.</p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
              {todaySales.slice(0, 20).map(s => {
                const style = METHOD_STYLE[s.method] || METHOD_STYLE.Cash
                const Icon = style.icon
                return (
                  <div key={s.id} className="flex items-center gap-3 py-2.5 border-b border-line last:border-b-0">
                    <span className={`size-9 rounded-full grid place-items-center shrink-0 ${style.className}`}>
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-ink truncate">
                        {s.receipt_no} · {s.method}
                      </div>
                      <div className="text-[11.5px] text-muted truncate">
                        {new Date(s.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                        {s.profiles?.full_name ? ` · ${s.profiles.full_name}` : ''}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[13px] text-green shrink-0">+{money(s.total)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <CategoryBreakdown money={money} title={isAdmin ? 'Sales by category' : 'My sales by category'} />
        </Card>

        {isAdmin && (
          <Card title="Partner split today" action={<button className="link" onClick={() => onNavigate('partners')}>Partners</button>}>
            <PartnerSplit money={money} refreshKey={todaySales.length} />
          </Card>
        )}

        <Card title="Payment split">
          {revenue === 0 ? (
            <p className="text-muted text-sm m-0">No sales yet today.</p>
          ) : (
            <DonutChart data={payData} money={money} centerLabel="today" height={180} />
          )}
        </Card>
      </div>
    </div>
  )
}
