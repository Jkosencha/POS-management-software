import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import ChartTooltip from './ChartTooltip'

const RAD = Math.PI / 180

// Percentage label drawn inside each segment (skipped for thin slices)
function SegmentLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.06) return null
  const r = innerRadius + (outerRadius - innerRadius) / 2
  const x = cx + r * Math.cos(-midAngle * RAD)
  const y = cy + r * Math.sin(-midAngle * RAD)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {Math.round(percent * 100)}%
    </text>
  )
}

/*
 * Finly-style donut: thick rounded segments with gaps, % labels on the
 * ring, a total in the middle and a two-column legend underneath.
 * data: [{ name, value, color }]
 */
export default function DonutChart({ data, money, centerLabel, centerValue, height = 210 }) {
  const shown = data.filter(d => d.value > 0)
  const total = shown.reduce((n, d) => n + d.value, 0)

  return (
    <div>
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown} dataKey="value" nameKey="name"
              innerRadius="52%" outerRadius="92%"
              startAngle={90} endAngle={-270}
              paddingAngle={shown.length > 1 ? 3 : 0}
              cornerRadius={8}
              stroke="none"
              labelLine={false}
              label={SegmentLabel}
              isAnimationActive={false}
            >
              {shown.map(d => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip money={money} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="font-bold text-[15px] text-ink leading-tight">{centerValue ?? money(total)}</div>
          {centerLabel && <div className="text-[10.5px] text-muted mt-0.5">{centerLabel}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 mt-4">
        {data.map(d => (
          <div key={d.name} className="flex items-start gap-2 min-w-0">
            <span className="size-2.5 rounded-full shrink-0 mt-1" style={{ background: d.color }} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink truncate">{d.name}</div>
              <div className="text-[11.5px] text-muted font-mono">{money(d.value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
