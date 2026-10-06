import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { todayKey } from '../lib/dates'
import Modal from '../components/Modal'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'
import { PartnerBadge, PartnerSelect } from '../components/PartnerBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ALL_TIME_FROM = '2000-01-01T00:00:00Z'

function PayoutForm({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(undefined)
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(todayKey())
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const valid = partnerId != null && Number(amount) > 0 && paidOn

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('partner_payouts').insert({
      partner_id: partnerId, amount: Number(amount), paid_on: paidOn, note: note.trim() || null,
    })
    setSaving(false)
    if (error) return setError(error.code === '42P01' ? 'Run migration 013 first.' : error.message)
    onSaved()
  }

  return (
    <Modal title="Record a payout" description="Money a partner took out of the business (cash or M-Pesa)." onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="alert-error">{error}</div>}
        <div className="field">
          <span>Paid to</span>
          <PartnerSelect partners={partners} value={partnerId} onChange={setPartnerId} includeShared={false} placeholder="Choose partner" />
        </div>
        <div className="field-row">
          <label className="field">
            <span>Amount (KSh)</span>
            <input type="number" min="0" step="any" autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={paidOn} max={todayKey()} onChange={e => setPaidOn(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Note (optional)</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. October profit share" />
        </label>
        <div className="flex gap-2 justify-end mt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!valid || saving}>{saving ? 'Saving...' : 'Record payout'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/*
 * Settle-up: each partner's all-time profit (their stock + their share of
 * Shared stock), what they've been paid out, and what's still unpaid.
 * Buying costs count as the business's money (stock gets restocked from
 * sales), so only profit is treated as owed to partners.
 */
export default function Payouts({ partners, byId, money, canEdit }) {
  const [summary, setSummary] = useState([])
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [adding, setAdding]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const [sum, pay] = await Promise.all([
      supabase.rpc('partner_summary', { p_from: ALL_TIME_FROM, p_to: tomorrow.toISOString() }),
      fetchAll(() => supabase.from('partner_payouts').select('*').order('paid_on', { ascending: false }).order('id')),
    ])
    setError(pay.error ? 'Payout tracking needs migration 013. Run it in the Supabase SQL editor.' : null)
    setSummary(sum.data || [])
    setPayouts(pay.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete() {
    const { data, error } = await supabase.from('partner_payouts').delete().eq('id', deleting.id).select('id')
    if (error) return error.message
    if (!data?.length) return 'Not deleted. Only the owner can delete payouts.'
    load()
  }

  const paidBy = {}
  payouts.forEach(p => { paidBy[p.partner_id] = (paidBy[p.partner_id] || 0) + Number(p.amount) })

  if (loading) return <div className="empty-grid">Loading...</div>

  return (
    <div className="p-4 sm:p-5">
      {error && <div className="alert-error">{error}</div>}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-[13px] text-ink-2 m-0 max-w-[620px]">
          Profit is what each partner's stock sold for minus what it cost (plus their share of Shared stock),
          since the shop opened. Buying costs stay in the business to restock. Record money a partner takes
          out to see what's still unpaid.
        </p>
        {canEdit && partners.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}><Plus /> Record payout</Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-5">
        {summary.map(r => {
          const profit = Number(r.own_revenue) + Number(r.shared_revenue) - Number(r.own_cost) - Number(r.shared_cost)
          const paid = paidBy[r.partner_id] || 0
          const unpaid = profit - paid
          return (
            <div key={r.partner_id} className="rounded-md border border-line p-4" style={{ boxShadow: `inset 4px 0 0 ${r.color}` }}>
              <PartnerBadge partner={r} />
              <div className="grid grid-cols-3 gap-2 mt-3 text-[13px]">
                <div>
                  <div className="text-[11px] text-muted">Profit to date</div>
                  <div className="font-semibold">{money(Math.round(profit))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Paid out</div>
                  <div className="font-semibold">{money(Math.round(paid))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">{unpaid < 0 ? 'Overpaid' : 'Unpaid'}</div>
                  <div className={`font-bold ${unpaid < 0 ? 'text-red' : 'text-green'}`}>{money(Math.round(Math.abs(unpaid)))}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-md border border-line overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="max-md:hidden">Note</TableHead>
              {canEdit && <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={canEdit ? 5 : 4} className="empty-grid">No payouts recorded yet.</TableCell>
              </TableRow>
            )}
            {payouts.map(p => (
              <TableRow key={p.id}>
                <TableCell className="text-[13px]">{new Date(`${p.paid_on}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
                <TableCell><PartnerBadge partner={byId(p.partner_id)} /></TableCell>
                <TableCell className="num font-semibold">{money(p.amount)}</TableCell>
                <TableCell className="text-muted text-xs max-md:hidden whitespace-normal">{p.note || '-'}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={() => setDeleting(p)} aria-label="Delete payout">
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {adding && <PayoutForm partners={partners} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}

      <PasswordConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title="Delete this payout?"
        description={deleting ? `The ${money(deleting.amount)} payout to ${byId(deleting.partner_id).name} is removed and their unpaid balance goes back up.` : ''}
        confirmLabel="Delete payout"
        onConfirm={handleDelete}
      />
    </div>
  )
}
