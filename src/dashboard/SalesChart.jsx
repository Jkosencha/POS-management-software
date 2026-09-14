import React, { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '../lib/supabase'

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
      date:    d.toISOString().slice(0, 10),
      label:   d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
      revenue: 0,
      count:   0,
    })
  }
  return days
}

const BAR_COLORS = [
  'var(--pastel-mint-fg)', 'var(--pastel-teal-fg)', 'var(--pastel-lavender-fg)',
  'var(--pastel-coral-fg)', 'var(--accent)',
]

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-line rounded-md shadow-md px-3 py-2 text-xs">
      <div className="text-muted mb-0.5">{label}</div>
      <div className="font-mono font-bold">KSh {payload[0].value.toLocaleString('en-KE')}</div>
    </div>
  )
}

export default function SalesChart() {
  const [period, setPeriod]   = useState('7')
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

      const { data: sales } = await supabase
        .from('sales')
        .select('total, created_at')
        .gte('created_at', from.toISOString())
        .eq('status', 'completed')

      if (cancelled) return

      const days = buildDays(n)
      ;(sales || []).forEach(s => {
        const key = s.created_at.slice(0, 10)
        const day = days.find(d => d.date === key)
        if (day) { day.revenue += Number(s.total); day.count++ }
      })
      setData(days)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [period])

  const totalRevenue = data.reduce((n, d) => n + d.revenue, 0)

  return (
    <div>
      <div className="flex justify-between items-start mb-4.5">
        <div>
          <h3 className="m-0 mb-0.5 text-sm font-extrabold text-ink">Revenue trend</h3>
          {!loading && (
            <div className="text-xs text-muted">
              {totalRevenue === 0
                ? 'No sales in this period'
                : `KSh ${totalRevenue.toLocaleString('en-KE')} total · ${period} days`}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {[['7', '7 days'], ['30', '30 days']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-semibold border-[1.5px] transition-all ${
                period === v
                  ? 'border-accent/35 bg-accent-tint text-accent-text'
                  : 'border-line bg-transparent text-muted hover:bg-surface-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-muted text-sm">Loading chart…</div>
      ) : totalRevenue === 0 ? (
        <div className="h-40 flex items-center justify-center text-muted text-sm italic">
          No completed sales in this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 4" />
            <XAxis
              dataKey="label" tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              interval={data.length > 10 ? 4 : 0}
            />
            <YAxis
              tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickFormatter={fmtAxis}
              width={40}
            />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {data.map((d, i) => (
                <Cell key={d.date} fill={BAR_COLORS[i % BAR_COLORS.length]} opacity={d.revenue > 0 ? 1 : 0.15} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
