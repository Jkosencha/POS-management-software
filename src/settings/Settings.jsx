import React, { useState, useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'
import { MIN_PASSWORD } from '../auth/SetPassword'
import { todayKey, daysAgoKey, startOfDay, startOfNextDay } from '../lib/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function ProfileSection() {
  const { session, profile } = useSession()
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  useEffect(() => {
    if (profile?.full_name) setName(profile.full_name)
  }, [profile?.full_name])

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session.user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="settings-section">
      <h2>Your profile</h2>
      <form onSubmit={handleSave}>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
        </label>
        <p className="muted note mt-0 mb-3.5">
          Appears in the dashboard greeting, on receipts, and in staff reports.
        </p>
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving...' : saved ? 'Saved' : 'Update name'}
        </Button>
      </form>
    </div>
  )
}

function PasswordSection() {
  const { session } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)

  const valid = current && next.length >= MIN_PASSWORD && next === confirm

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    // Re-check the current password before allowing a change
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email, password: current,
    })
    if (authError) {
      setSaving(false)
      return setMsg({ type: 'err', text: 'Current password is incorrect.' })
    }
    const { error } = await supabase.auth.updateUser({ password: next })
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
    setCurrent(''); setNext(''); setConfirm('')
    setMsg({ type: 'ok', text: 'Password changed.' })
  }

  return (
    <div className="settings-section">
      <h2>Change password</h2>
      <form onSubmit={handleSubmit}>
        {msg && <div className={msg.type === 'ok' ? 'alert-success' : 'alert-error'}>{msg.text}</div>}
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
        </div>
        <p className={`text-xs mt-0 mb-3.5 ${confirm && next !== confirm ? 'text-red' : 'text-muted'}`}>
          {confirm && next !== confirm ? "Passwords don't match." : `At least ${MIN_PASSWORD} characters.`}
        </p>
        <Button type="submit" disabled={!valid || saving}>
          {saving ? 'Saving...' : 'Change password'}
        </Button>
      </form>
    </div>
  )
}

// Data types the owner can bulk-delete by date range
const PURGE_TARGETS = [
  { value: 'sales', label: 'Sales', rpc: 'purge_sales' },
]

function DangerZone() {
  const [target, setTarget]     = useState('sales')
  const [from, setFrom]         = useState(daysAgoKey(30))
  const [to, setTo]             = useState(todayKey())
  const [password, setPassword] = useState('')
  const [count, setCount]       = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState(null)

  const rangeValid = from && to && from <= to

  // Preview how many records the range covers
  useEffect(() => {
    if (!rangeValid) { setCount(null); return }
    let cancelled = false
    supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay(from).toISOString())
      .lt('created_at', startOfNextDay(to).toISOString())
      .then(({ count }) => { if (!cancelled) setCount(count ?? 0) })
    return () => { cancelled = true }
  }, [from, to, rangeValid, msg])

  async function handleDelete() {
    setConfirmOpen(false)
    setBusy(true)
    setMsg(null)
    const { rpc } = PURGE_TARGETS.find(t => t.value === target)
    const { data, error } = await supabase.rpc(rpc, {
      p_from: startOfDay(from).toISOString(),
      p_to: startOfNextDay(to).toISOString(),
      p_password: password,
    })
    setBusy(false)
    setPassword('')
    if (error) {
      return setMsg({
        type: 'err',
        text: error.code === 'PGRST202' ? 'Run migration 009 in the Supabase SQL editor first.' : error.message,
      })
    }
    setMsg({ type: 'ok', text: `Deleted ${data} sale${data === 1 ? '' : 's'}.` })
  }

  const label = PURGE_TARGETS.find(t => t.value === target).label.toLowerCase()

  return (
    <div className="settings-section danger">
      <h2 className="flex items-center gap-2"><TriangleAlert size={17} /> Danger zone</h2>
      <p className="text-sm text-ink-2 mt-0 mb-4">
        Permanently delete records in a date range. This cannot be undone. Stock levels are not
        changed, and stock movement history is kept.
      </p>

      {msg && <div className={msg.type === 'ok' ? 'alert-success' : 'alert-error'}>{msg.text}</div>}

      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <div className="flex flex-col gap-1.5">
          <Label>Data to delete</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PURGE_TARGETS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purge-from">From</Label>
          <Input id="purge-from" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purge-to">To</Label>
          <Input id="purge-to" type="date" value={to} min={from} max={todayKey()} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-3">
        <Label htmlFor="purge-password">Your password</Label>
        <Input
          id="purge-password" type="password" autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Required to delete data"
        />
      </div>

      <p className="text-sm text-ink-2 mb-3.5 mt-0">
        {count === null ? 'Choose a valid date range.' : (
          <><strong className="text-red">{count}</strong> {label} record{count === 1 ? '' : 's'} in this range.</>
        )}
      </p>

      <Button
        variant="destructive"
        disabled={!rangeValid || !password || !count || busy}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? 'Deleting...' : `Delete ${label}`}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} {label} record{count === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every {label.replace(/s$/, '')} from {from} to {to}, including its line items, will be
              permanently deleted and removed from all reports. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>Yes, delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default function Settings({ settings, onSettingsChanged, role }) {
  const [f, setF]         = useState({ ...settings })
  const [toast, setToast] = useState(null)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const canEdit = role === 'owner'

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 2200) }

  const handleSave = async () => {
    const { error } = await supabase.from('settings').update({
      store_name:     f.store_name,
      currency:       f.currency,
      tax_rate:       Number(f.tax_rate) || 0,
      receipt_footer: f.receipt_footer,
    }).eq('id', true)

    if (error) return flash(error.message)
    flash('Settings saved')
    onSettingsChanged({ ...f, tax_rate: Number(f.tax_rate) || 0 })
  }

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>

      <ProfileSection />
      <PasswordSection />

      <div className="settings-section">
        <h2>Store</h2>
        <label className="field">
          <span>Store name</span>
          <input value={f.store_name} onChange={set('store_name')} disabled={!canEdit} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Currency symbol</span>
            <input value={f.currency} onChange={set('currency')} disabled={!canEdit} />
          </label>
          <label className="field">
            <span>VAT rate % (included in prices)</span>
            <input type="number" min="0" value={f.tax_rate} onChange={set('tax_rate')} disabled={!canEdit} />
          </label>
        </div>
        <label className="field">
          <span>Receipt footer message</span>
          <input value={f.receipt_footer} onChange={set('receipt_footer')} disabled={!canEdit} />
        </label>
        {canEdit ? (
          <Button onClick={handleSave}>Save settings</Button>
        ) : (
          <p className="muted note">Only the owner can edit store settings.</p>
        )}
      </div>

      {role === 'owner' && <DangerZone />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
