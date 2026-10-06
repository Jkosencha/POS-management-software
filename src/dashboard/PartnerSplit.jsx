import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import DonutChart from './DonutChart'

// Today's revenue per partner (their own stock + their half of shared stock)
export default function PartnerSplit({ money, refreshKey }) {
  const [rows, setRows]       = useState(null)
  const [error, setError]     = useState(null)

  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from); to.setDate(to.getDate() + 1)
    supabase.rpc('partner_summary', { p_from: from.toISOString(), p_to: to.toISOString() })
      .then(({ data, error }) => {
        setError(error ? 'Run migration 010 to enable partner tracking.' : null)
        setRows(data || [])
      })
  }, [refreshKey])

  if (rows === null) return <p className="text-muted text-sm m-0">Loading...</p>
  if (error) return <p className="text-muted text-sm m-0">{error}</p>
  if (rows.length === 0) return <p className="text-muted text-sm m-0">Add partners on the Partners page to split sales by owner.</p>

  const data = rows.map(r => ({
    name: r.name,
    value: Number(r.own_revenue) + Number(r.shared_revenue),
    color: r.color,
  }))
  if (data.every(d => d.value === 0)) return <p className="text-muted text-sm m-0">No sales yet today.</p>

  return <DonutChart data={data} money={money} centerLabel="today" height={180} />
}
