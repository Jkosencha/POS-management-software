import React, { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import DonutChart from './DonutChart'

const COLORS = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-2)']
const MAX_SLICES = 5

// Sales by product category for one calendar month, with < month > navigation
export default function CategoryBreakdown({ money, title = 'Sales by category' }) {
  const [monthOffset, setMonthOffset] = useState(0) // 0 = this month, -1 = last month...
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)

  const start = new Date()
  start.setDate(1); start.setHours(0, 0, 0, 0)
  start.setMonth(start.getMonth() + monthOffset)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  const startIso = start.toISOString()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const from = new Date(startIso)
    const to = new Date(from); to.setMonth(to.getMonth() + 1)

    fetchAll(() => supabase
      .from('sale_items')
      .select('line_total, products(category), sales!inner(created_at, status)')
      .gte('sales.created_at', from.toISOString())
      .lt('sales.created_at', to.toISOString())
      .eq('sales.status', 'completed')
      .order('id'))
      .then(({ data: rows }) => {
        if (cancelled) return
        const totals = {}
        ;(rows || []).forEach(r => {
          const cat = r.products?.category || 'Other'
          totals[cat] = (totals[cat] || 0) + Number(r.line_total)
        })
        const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
        // Fold the long tail into "Other" so the donut stays readable
        const head = sorted.slice(0, MAX_SLICES - 1)
        const tail = sorted.slice(MAX_SLICES - 1)
        if (tail.length === 1) head.push(tail[0])
        else if (tail.length > 1) head.push(['Other', tail.reduce((n, [, v]) => n + v, 0)])
        setData(head.map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] })))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [startIso])

  const monthLabel = start.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <button
          className="size-7 rounded-full grid place-items-center text-ink-2 hover:bg-surface-2"
          onClick={() => setMonthOffset(m => m - 1)}
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-bold text-ink">{monthLabel}</div>
        <button
          className="size-7 rounded-full grid place-items-center text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={() => setMonthOffset(m => Math.min(0, m + 1))}
          disabled={monthOffset >= 0}
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="text-[13px] font-semibold text-ink-2 mb-2">{title}</div>

      {loading ? (
        <div className="h-52 grid place-items-center text-muted text-sm">Loading...</div>
      ) : data.length === 0 ? (
        <div className="h-52 grid place-items-center text-muted text-sm">No sales this month</div>
      ) : (
        <DonutChart data={data} money={money} centerLabel="this month" />
      )}
    </div>
  )
}
