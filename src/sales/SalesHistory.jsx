import React, { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { todayKey, daysAgoKey, startOfDay, startOfNextDay } from '../lib/dates'
import { Input } from '@/components/ui/input'
import ReceiptModal from '../register/ReceiptModal'
import VoidModal from './VoidModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const PRESETS = [
  { label: 'Today',       from: todayKey,            to: todayKey },
  { label: 'Yesterday',   from: () => daysAgoKey(1), to: () => daysAgoKey(1) },
  { label: 'Last 7 days', from: () => daysAgoKey(6), to: todayKey },
  { label: 'Last 30 days', from: () => daysAgoKey(29), to: todayKey },
]

export default function SalesHistory({ money, settings, role }) {
  const [sales, setSales]     = useState([])
  const [viewSale, setViewSale] = useState(null)
  const [voidSale, setVoidSale] = useState(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset]   = useState('Today')
  const [from, setFrom]       = useState(todayKey())
  const [to, setTo]           = useState(todayKey())
  const [q, setQ]             = useState('')
  const [method, setMethod]   = useState('All')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Cashiers only get their own sales back (RLS)
    fetchAll(() => supabase
      .from('sales')
      .select('*, sale_items(*), profiles:cashier_id(full_name)')
      .gte('created_at', startOfDay(from).toISOString())
      .lt('created_at', startOfNextDay(to).toISOString())
      .order('created_at', { ascending: false })
      .order('id'))
      .then(({ data }) => {
        if (cancelled) return
        setSales((data || []).map(s => ({ ...s, items: s.sale_items || [] })))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [from, to])

  const applyPreset = p => { setPreset(p.label); setFrom(p.from()); setTo(p.to()) }

  const needle = q.trim().toLowerCase()
  const shown = sales.filter(s =>
    (method === 'All' || s.method === method) &&
    (!needle || s.receipt_no.toLowerCase().includes(needle) ||
      s.items.some(i => i.name.toLowerCase().includes(needle)))
  )
  const completed = shown.filter(s => s.status !== 'voided')
  const shownTotal = completed.reduce((n, s) => n + Number(s.total), 0)

  function handleVoided(saleId) {
    setSales(prev => prev.map(s =>
      s.id === saleId ? { ...s, status: 'voided' } : s
    ))
  }

  const canVoid = role === 'manager' || role === 'owner'

  return (
    <div className="page">
      <header className="page-head"><h1>Sales</h1></header>

      <div className="flex gap-2 flex-wrap items-center mb-3">
        {PRESETS.map(p => (
          <button key={p.label} className={`cat ${preset === p.label ? 'on' : ''}`} onClick={() => applyPreset(p)}>{p.label}</button>
        ))}
        <div className="flex gap-1.5 items-center sm:ml-1">
          <input type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setPreset('Custom') }}
            className="h-8 px-3 rounded-full border border-line bg-surface text-ink text-[13px]" />
          <span className="text-muted text-[13px]">to</span>
          <input type="date" value={to} min={from} max={todayKey()} onChange={e => { setTo(e.target.value); setPreset('Custom') }}
            className="h-8 px-3 rounded-full border border-line bg-surface text-ink text-[13px]" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 items-center mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input className="pl-10 rounded-full" placeholder="Search receipt no. or product..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {['All', 'Cash', 'M-Pesa', 'Card'].map(m => (
            <button key={m} className={`cat ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{m}</button>
          ))}
        </div>
      </div>

      {!loading && (
        <p className="text-sm text-ink-2 mt-0 mb-3">
          <strong className="text-ink">{completed.length}</strong> sale{completed.length === 1 ? '' : 's'} totalling{' '}
          <strong className="text-ink">{money(shownTotal)}</strong>
          {shown.length > completed.length && <span className="text-muted"> ({shown.length - completed.length} voided, not counted)</span>}
        </p>
      )}

      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Receipt</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="max-lg:hidden">Cashier</TableHead>
              <TableHead className="max-md:hidden">Items</TableHead>
              <TableHead>Paid by</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="empty-grid">Loading sales...</TableCell></TableRow>
            )}
            {!loading && shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="empty-grid">No sales match this period and filter.</TableCell>
              </TableRow>
            )}
            {!loading && shown.map(s => {
              const voided = s.status === 'voided'
              return (
                <TableRow key={s.id} className={voided ? 'opacity-55' : ''}>
                  <TableCell className={`mono font-semibold ${voided ? 'line-through' : ''}`}>{s.receipt_no}</TableCell>
                  <TableCell className="text-[13px] text-ink-2">
                    {new Date(s.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell className="text-ink-2 text-[13px] max-lg:hidden">{s.profiles?.full_name || '-'}</TableCell>
                  <TableCell className="text-ink-2 max-md:hidden">{(s.items || []).reduce((n, i) => n + i.qty, 0)} items</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      {s.method}
                      {voided && <Badge variant="destructive">VOID</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="num font-semibold">{money(s.total)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="text-accent hover:text-accent" onClick={() => setViewSale(s)}>
                        Receipt
                      </Button>
                      {canVoid && !voided && (
                        <Button size="sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={() => setVoidSale(s)}>
                          Void
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {viewSale && (
        <ReceiptModal
          sale={viewSale}
          settings={settings}
          money={money}
          onClose={() => setViewSale(null)}
        />
      )}

      {voidSale && (
        <VoidModal
          sale={voidSale}
          money={money}
          onClose={() => setVoidSale(null)}
          onVoided={handleVoided}
        />
      )}
    </div>
  )
}
