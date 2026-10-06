import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { usePartners, SHARED, PARTNER_SWATCHES } from '../lib/partners'
import { todayKey, daysAgoKey, pad2, startOfDay, startOfNextDay } from '../lib/dates'
import Modal from '../components/Modal'
import Payouts from './Payouts'
import { PartnerBadge, PartnerDot } from '../components/PartnerBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'

const PRESETS = [
  { label: 'Today',       from: todayKey,              to: todayKey },
  { label: 'Last 7 days', from: () => daysAgoKey(6),   to: todayKey },
  { label: 'This month',  from: () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01` }, to: todayKey },
  { label: 'This year',   from: () => `${new Date().getFullYear()}-01-01`, to: todayKey },
]

function PartnerForm({ partner, usedColors, onClose, onSaved }) {
  const isEdit = Boolean(partner?.id)
  const [name, setName]   = useState(partner?.name || '')
  const [color, setColor] = useState(partner?.color || PARTNER_SWATCHES.find(c => !usedColors.includes(c)) || PARTNER_SWATCHES[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const row = { name: name.trim(), color }
    const { error } = isEdit
      ? await supabase.from('partners').update(row).eq('id', partner.id)
      : await supabase.from('partners').insert(row)
    setSaving(false)
    if (error) return setError(error.code === '23505' ? 'A partner with that name already exists.' : error.message)
    onSaved(isEdit ? 'Partner updated' : 'Partner added')
  }

  return (
    <Modal
      title={isEdit ? 'Edit partner' : 'Add partner'}
      description="Each partner gets a color used across inventory, sales records and charts."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <div className="alert-error mb-0">{error}</div>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partner-name">Name</Label>
          <Input id="partner-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane" />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Color</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PARTNER_SWATCHES.map(c => (
              <button
                key={c} type="button"
                className={`size-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface scale-110' : 'hover:scale-105'}`}
                style={{ background: c, '--tw-ring-color': c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
            <label className="size-8 rounded-full border border-dashed border-line grid place-items-center cursor-pointer overflow-hidden relative" title="Custom color">
              <span className="text-xs text-muted">+</span>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>
          <div className="mt-1"><PartnerBadge partner={{ name: name.trim() || 'Preview', color }} /></div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add partner'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function PartnerCard({ row, money, canEdit, onEdit, onDelete }) {
  const revenue = Number(row.own_revenue) + Number(row.shared_revenue)
  const cost    = Number(row.own_cost) + Number(row.shared_cost)
  const profit  = revenue - cost
  return (
    <div className="rounded-lg bg-surface shadow-sm overflow-hidden">
      <div className="h-1.5" style={{ background: row.color }} />
      <div className="p-4.5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="size-9 rounded-full grid place-items-center text-white font-bold shrink-0" style={{ background: row.color }}>
              {row.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="font-bold text-ink truncate">{row.name}</span>
          </div>
          {canEdit && (
            <div className="flex gap-0.5 shrink-0">
              <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="Edit partner"><Pencil /></Button>
              <Button size="icon-sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={onDelete} aria-label="Delete partner"><Trash2 /></Button>
            </div>
          )}
        </div>
        <div className="text-xs text-muted">Revenue</div>
        <div className="text-2xl font-bold text-ink leading-tight">{money(Math.round(revenue))}</div>
        {Number(row.shared_revenue) > 0 && (
          <div className="text-[11.5px] text-muted mt-0.5">incl. {money(Math.round(row.shared_revenue))} share of shared stock</div>
        )}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-line text-[13px]">
          <div>
            <div className="text-[11px] text-muted">Profit</div>
            <div className={`font-semibold ${profit < 0 ? 'text-red' : 'text-green'}`}>{money(Math.round(profit))}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Units sold</div>
            <div className="font-semibold">{Math.round(Number(row.units_sold))}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Stock value</div>
            <div className="font-semibold">{money(Math.round(row.stock_value))}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Partners({ money, role }) {
  const canEdit = role === 'owner'
  const { partners, refresh: refreshPartners, byId } = usePartners()

  const [preset, setPreset] = useState('This month')
  const [from, setFrom] = useState(PRESETS[2].from())
  const [to, setTo]     = useState(todayKey())
  const [summary, setSummary] = useState([])
  const [records, setRecords] = useState([])
  const [stock, setStock]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tab, setTab]         = useState('sales')   // 'sales' | 'stock' | 'payouts'
  const [owner, setOwner]     = useState('all')     // 'all' | partner id | 'shared'
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [toast, setToast]     = useState(null)

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const range = { p_from: startOfDay(from).toISOString(), p_to: startOfNextDay(to).toISOString() }
    const [sum, rec, stk] = await Promise.all([
      supabase.rpc('partner_summary', range),
      fetchAll(() => supabase.rpc('partner_sales_records', range)),
      fetchAll(() => supabase.from('stock_batches')
        .select('id, partner_id, qty_remaining, unit_cost, product_id, products(name)')
        .gt('qty_remaining', 0)
        .order('id')),
    ])
    const err = sum.error || rec.error || stk.error
    setError(err ? (err.code === 'PGRST202' || err.code === '42P01'
      ? 'Partner tracking needs migration 010. Run it in the Supabase SQL editor.'
      : err.message) : null)
    setSummary(sum.data || [])
    setRecords(rec.data || [])
    setStock(stk.data || [])
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  const applyPreset = p => { setPreset(p.label); setFrom(p.from()); setTo(p.to()) }

  // Returns an error message for the confirm dialog, or nothing on success
  async function handleDelete() {
    const p = deleting
    const { data, error } = await supabase.from('partners').delete().eq('id', p.id).select('id')
    if (error) {
      return error.code === '23503'
        ? `${p.name} has stock history, so they can't be removed. Rename them instead.`
        : error.message
    }
    if (!data?.length) return 'Not removed. Only the owner can remove partners.'
    flash(`${p.name} removed`)
    refreshPartners(); fetchData()
  }

  const matchesOwner = pid => owner === 'all' || (owner === 'shared' ? pid == null : pid === owner)
  const shownRecords = records.filter(r => matchesOwner(r.partner_id))
  const shownStock   = stock.filter(b => matchesOwner(b.partner_id))

  const recTotals = shownRecords.reduce((t, r) => ({
    qty: t.qty + r.qty, revenue: t.revenue + Number(r.revenue), cost: t.cost + Number(r.cost),
  }), { qty: 0, revenue: 0, cost: 0 })

  // Shared stock/sales totals (the RPC reports each partner's share separately)
  const sharedRevenue = records.filter(r => r.partner_id == null).reduce((n, r) => n + Number(r.revenue), 0)

  // Group stock by product + owner for the stock tab
  const stockRows = Object.values(shownStock.reduce((acc, b) => {
    const key = `${b.product_id}:${b.partner_id ?? 's'}`
    acc[key] = acc[key] || { key, name: b.products?.name || '?', partner_id: b.partner_id, units: 0, value: 0 }
    acc[key].units += b.qty_remaining
    acc[key].value += b.qty_remaining * Number(b.unit_cost || 0)
    return acc
  }, {})).sort((a, b) => a.name.localeCompare(b.name))
  const stockTotals = stockRows.reduce((t, r) => ({ units: t.units + r.units, value: t.value + r.value }), { units: 0, value: 0 })

  const ownerTabs = [
    { key: 'all', label: 'Everyone' },
    ...partners.map(p => ({ key: p.id, label: p.name, color: p.color })),
    { key: 'shared', label: 'Shared', color: SHARED.color },
  ]

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <header className="page-head">
        <h1>Partners</h1>
        {canEdit && <Button onClick={() => setEditing({})}><Plus /> Add partner</Button>}
      </header>
      <p className="page-sub">
        Each restock records whose stock it is. Sales use up the oldest stock first, so every sale is credited
        to the partner who owned those units. Shared stock is split evenly between partners.
      </p>

      {error && <div className="alert-error">{error}</div>}

      <div className="flex gap-2 flex-wrap items-center mb-4">
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

      {/* partner cards */}
      {!loading && partners.length === 0 && !error && (
        <div className="card text-sm text-ink-2 mb-4">
          No partners yet. {canEdit ? 'Add yourself and your partner to start tracking whose stock sells.' : 'Ask the owner to add the business partners.'}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {summary.map(row => (
          <PartnerCard
            key={row.partner_id}
            row={row}
            money={money}
            canEdit={canEdit}
            onEdit={() => setEditing(partners.find(p => p.id === row.partner_id))}
            onDelete={() => setDeleting(partners.find(p => p.id === row.partner_id))}
          />
        ))}
        {summary.length > 0 && (
          <div className="rounded-lg bg-surface-2 p-4.5 text-[13px] text-ink-2 flex flex-col justify-center gap-1">
            <div className="flex items-center gap-2 font-semibold text-ink"><PartnerDot color={SHARED.color} /> Shared stock</div>
            <div>{money(Math.round(sharedRevenue))} in sales from shared stock this period, split evenly across the partner totals.</div>
          </div>
        )}
      </div>

      {/* records */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex gap-1 rounded-full bg-surface p-1 shadow-sm">
          {[['sales', 'Sales records'], ['stock', 'Stock on hand'], ['payouts', 'Payouts']].map(([k, label]) => (
            <button
              key={k}
              className={`px-4 h-8 rounded-full text-[13px] font-semibold transition-colors ${tab === k ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={`flex flex-wrap gap-1.5 ${tab === 'payouts' ? 'invisible' : ''}`}>
          {ownerTabs.map(t => (
            <button
              key={t.key}
              className={`cat inline-flex items-center gap-1.5 ${owner === t.key ? 'on' : ''}`}
              style={owner === t.key && t.color ? { background: t.color, borderColor: t.color } : undefined}
              onClick={() => setOwner(t.key)}
            >
              {t.color && owner !== t.key && <PartnerDot color={t.color} className="size-2" />}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-card">
        {tab === 'payouts' ? (
          <Payouts partners={partners} byId={byId} money={money} canEdit={canEdit} />
        ) : tab === 'sales' ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right max-sm:hidden">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="empty-grid">Loading...</TableCell></TableRow>}
              {!loading && shownRecords.length === 0 && (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="empty-grid">No sales in this period.</TableCell></TableRow>
              )}
              {!loading && shownRecords.map(r => {
                const p = byId(r.partner_id)
                const profit = Number(r.revenue) - Number(r.cost)
                return (
                  <TableRow key={r.allocation_id} style={{ boxShadow: `inset 3px 0 0 ${p.color}` }}>
                    <TableCell className="mono text-xs text-ink-2">
                      {new Date(r.sold_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="mono text-xs">{r.receipt_no}</TableCell>
                    <TableCell className="font-medium">{r.product_name}</TableCell>
                    <TableCell><PartnerBadge partner={p} /></TableCell>
                    <TableCell className="num">{r.qty}</TableCell>
                    <TableCell className="num font-semibold">{money(r.revenue)}</TableCell>
                    <TableCell className={`num max-sm:hidden ${profit < 0 ? 'text-red' : 'text-green'}`}>{money(Math.round(profit))}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            {!loading && shownRecords.length > 0 && (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell className="num">{recTotals.qty}</TableCell>
                  <TableCell className="num">{money(Math.round(recTotals.revenue))}</TableCell>
                  <TableCell className="num max-sm:hidden">{money(Math.round(recTotals.revenue - recTotals.cost))}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Product</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Value at cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="empty-grid">Loading...</TableCell></TableRow>}
              {!loading && stockRows.length === 0 && (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="empty-grid">No stock on hand.</TableCell></TableRow>
              )}
              {!loading && stockRows.map(r => {
                const p = byId(r.partner_id)
                return (
                  <TableRow key={r.key} style={{ boxShadow: `inset 3px 0 0 ${p.color}` }}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><PartnerBadge partner={p} /></TableCell>
                    <TableCell className="num">{r.units}</TableCell>
                    <TableCell className="num">{money(Math.round(r.value))}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            {!loading && stockRows.length > 0 && (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="num">{stockTotals.units}</TableCell>
                  <TableCell className="num">{money(Math.round(stockTotals.value))}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </div>

      {editing && (
        <PartnerForm
          partner={editing}
          usedColors={partners.map(p => p.color)}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); flash(msg); refreshPartners(); fetchData() }}
        />
      )}

      <PasswordConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Remove ${deleting?.name}?`}
        description="Only a partner who has never owned any stock can be removed. Once stock has been recorded under a partner, their history is kept and they can only be renamed."
        confirmLabel="Remove partner"
        onConfirm={handleDelete}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
