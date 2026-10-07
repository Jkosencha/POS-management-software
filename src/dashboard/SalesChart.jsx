import React, { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { localKey } from '../lib/dates'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ChartTooltip from './ChartTooltip'

const PERIODS = [
  { value: '7',  label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

function fmtAxis(v) {
  if (v === 0) return '0'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000)      return `${Math.round(v / 1000)}k`
  return String(Math.round(v))
}

function buildDays(n) {
  const days = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({
      date:    localKey(d),
      label:   d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }),
      revenue: 0,
      cost:    0,
    })
  }
  return days
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  )
}

/*
 * Revenue vs cost of goods sold per day (Finly "Income vs Expenses" look).
 * Cost comes from the cost_price snapshot on each sale line, so days with
 * un-costed products under-state cost.
 */
export default function SalesChart({ money, showCost = true }) {
  const [period, setPeriod]   = useState('30')
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const n    = Number(period)
      const from = new Date()
      from.setDate(from.getDate() - n + 1)
      from.setHours(0, 0, 0, 0)

      const { data: sales } = await fetchAll(() => supabase
        .from('sales')
        .select('total, created_at, sale_items(qty, cost_price)')
        .gte('created_at', from.toISOString())
        .eq('status', 'completed')
        .order('id'))

      if (cancelled) return

      const days = buildDays(n)
      const byKey = Object.fromEntries(days.map(d => [d.date, d]))
      ;(sales || []).forEach(s => {
        const day = byKey[localKey(new Date(s.created_at))]
        if (!day) return
        day.revenue += Number(s.total)
        ;(s.sale_items || []).forEach(i => {
          if (i.cost_price != null) day.cost += Number(i.cost_price) * i.qty
        })
      })
      setData(days)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [period])

  const totalRevenue = data.reduce((n, d) => n + d.revenue, 0)
  const totalCost    = data.reduce((n, d) => n + d.cost, 0)

  return (
    <div>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-5">
        <div>
          <h3 className="m-0 text-[15px] font-bold text-ink">{showCost ? 'Revenue vs. Cost' : 'Sales'}</h3>
          <div className="flex gap-4 mt-2">
            <LegendDot color="var(--chart-1)" label="Revenue" />
            {showCost && <LegendDot color="var(--chart-2)" label="Cost" />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {showCost && !loading && totalRevenue > 0 && (
            <div className="text-right hidden sm:block">
              <div className="text-[11px] text-muted">Gross profit</div>
              <div className="font-mono font-bold text-sm text-ink">{money(Math.round(totalRevenue - totalCost))}</div>
            </div>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger size="sm" className="w-[140px] rounded-full bg-surface-2 border-transparent font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="h-60 flex items-center justify-center text-muted text-sm">Loading chart...</div>
      ) : totalRevenue === 0 ? (
        <div className="h-60 flex items-center justify-center text-muted text-sm">
          No completed sales in this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 10, right: 6, left: -6, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--chart-1)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="label" tickLine={false} axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              interval="preserveStartEnd" minTickGap={18} dy={6}
            />
            <YAxis
              tickLine={false} axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickFormatter={fmtAxis}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: 'var(--chart-1)', strokeWidth: 1.5, strokeDasharray: '4 4' }}
              content={<ChartTooltip money={money} />}
            />
            <Area
              type="monotone" dataKey="revenue" name="Revenue"
              stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#revenueFill)"
              dot={false} activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--surface)', fill: 'var(--chart-1)' }}
            />
            {showCost && (
              <Area
                type="monotone" dataKey="cost" name="Cost"
                stroke="var(--chart-2)" strokeWidth={2.5} fill="transparent"
                dot={false} activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--surface)', fill: 'var(--chart-2)' }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
