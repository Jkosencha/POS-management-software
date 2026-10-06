import React from 'react'

// Dark pill tooltip shared by the dashboard charts (inverts in dark mode)
export default function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-sm px-3 py-2 text-xs shadow-lg bg-(--chart-tooltip-bg) text-(--chart-tooltip-fg)">
      {label && <div className="opacity-70 mb-1">{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 font-semibold">
          <span className="size-2 rounded-full" style={{ background: p.color || p.payload?.color }} />
          <span className="opacity-80 font-medium">{p.name}</span>
          <span className="ml-auto pl-3 font-mono">{money ? money(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}
