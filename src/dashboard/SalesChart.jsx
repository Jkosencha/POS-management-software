import React, { useState, useEffect } from 'react'
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

  /* ---- SVG layout ---- */
  const W = 580, H = 160
  const PL = 50, PR = 14, PT = 12, PB = 38
  const pw = W - PL - PR
  const ph = H - PT - PB

  const maxR = Math.max(...data.map(d => d.revenue), 1)
  const cx   = i => PL + (i / Math.max(data.length - 1, 1)) * pw
  const cy   = v => PT + ph - (v / maxR) * ph * 0.92

  const pts      = data.map((d, i) => [cx(i), cy(d.revenue)])
  const linePath = data.length > 1
    ? pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    : ''
  const fillPath = data.length > 1
    ? `M${pts[0][0].toFixed(1)},${(PT + ph).toFixed(1)} ` +
      pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ` L${pts[pts.length - 1][0].toFixed(1)},${(PT + ph).toFixed(1)}Z`
    : ''

  const yTicks = [0, Math.round(maxR / 2), maxR]
  const xStep  = data.length <= 10 ? 1 : 5
  const totalRevenue = data.reduce((n, d) => n + d.revenue, 0)

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 18,
      }}>
        <div>
          <h3 style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>
            Revenue trend
          </h3>
          {!loading && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {totalRevenue === 0
                ? 'No sales in this period'
                : `KSh ${totalRevenue.toLocaleString('en-KE')} total · ${period} days`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['7', '7 days'], ['30', '30 days']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              style={{
                padding: '5px 13px', borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                border: `1.5px solid ${period === v ? 'rgba(184,150,58,.35)' : 'var(--line)'}`,
                background: period === v ? 'var(--accent-tint)' : 'transparent',
                color: period === v ? 'var(--accent-text)' : 'var(--muted)',
                cursor: 'pointer', fontFamily: 'var(--font-ui)',
                transition: 'all .12s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Loading chart…
        </div>
      ) : totalRevenue === 0 ? (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
          No completed sales in this period
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block', color: 'var(--muted)' }}
          overflow="visible"
        >
          <defs>
            <linearGradient id="sg-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid + Y labels */}
          {yTicks.map((v, i) => (
            <React.Fragment key={i}>
              <line
                x1={PL} x2={PL + pw} y1={cy(v)} y2={cy(v)}
                stroke="currentColor"
                strokeOpacity={i === 0 ? '0.2' : '0.1'}
                strokeWidth="1"
                strokeDasharray={i === 0 ? undefined : '4 4'}
              />
              <text x={PL - 6} y={cy(v) + 4} textAnchor="end" fontSize="10" fill="currentColor">
                {fmtAxis(v)}
              </text>
            </React.Fragment>
          ))}

          {/* Area fill */}
          {fillPath && <path d={fillPath} fill="url(#sg-grad)" />}

          {/* Line */}
          {linePath && (
            <path
              d={linePath} fill="none"
              stroke="var(--accent)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            />
          )}

          {/* Data points */}
          {data.map((d, i) => d.revenue > 0 && (
            <circle key={i}
              cx={cx(i)} cy={cy(d.revenue)} r="3.5"
              fill="var(--surface)" stroke="var(--accent)" strokeWidth="2"
            />
          ))}

          {/* X labels */}
          {data
            .filter((_, i) => i % xStep === 0 || i === data.length - 1)
            .map(d => {
              const i = data.indexOf(d)
              return (
                <text key={d.date}
                  x={cx(i)} y={H - 4}
                  textAnchor="middle" fontSize="10" fill="currentColor"
                >
                  {d.label}
                </text>
              )
            })}
        </svg>
      )}
    </div>
  )
}
