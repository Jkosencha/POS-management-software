import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'

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
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your full name"
          />
        </label>
        <p className="muted note" style={{ marginTop: 0, marginBottom: 14 }}>
          Appears in the dashboard greeting, on receipts, and in staff reports.
        </p>
        <button className="btn pay" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Update name'}
        </button>
      </form>
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
          <button className="btn pay" onClick={handleSave}>Save settings</button>
        ) : (
          <p className="muted note">Only the owner can edit store settings.</p>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
