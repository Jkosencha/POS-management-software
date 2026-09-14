import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

const COLORS = {
  Cash:    'var(--pastel-mint-fg)',
  'M-Pesa': 'var(--pastel-teal-fg)',
  Card:    'var(--pastel-lavender-fg)',
}

export default function PaymentDonut({ paySplit, revenue, money }) {
  const methods = ['Cash', 'M-Pesa', 'Card']
  const data = methods
    .map(m => ({ name: m, value: paySplit[m] }))
    .filter(d => d.value > 0)

  return (
    <div className="flex items-center gap-5.5">
      <div className="relative w-30 h-30 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="name"
              innerRadius="68%" outerRadius="100%"
              startAngle={90} endAngle={-270}
              stroke="none"
            >
              {data.map(d => <Cell key={d.name} fill={COLORS[d.name]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[10px] text-muted font-bold tracking-wide">TOTAL</div>
          <div className="font-mono font-bold text-[15px] text-ink">{money(revenue)}</div>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {methods.map(m => {
          const pct = revenue > 0 ? Math.round(paySplit[m] / revenue * 100) : 0
          return (
            <div key={m} className="flex items-center gap-2 mb-2.5 text-[13px]">
              <span className="w-2.25 h-2.25 rounded-full shrink-0" style={{ background: COLORS[m] }} />
              <span className="flex-1 text-ink-2">{m}</span>
              <span className="font-mono font-bold text-xs">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
