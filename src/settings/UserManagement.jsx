import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'

const ROLES = ['cashier', 'manager', 'owner']

const ROLE_BADGE = {
  owner:   { background: 'var(--accent-tint)', color: 'var(--accent-text)' },
  manager: { background: 'var(--green-tint)',  color: 'var(--green)' },
  cashier: { background: 'var(--surface-2)',   color: 'var(--muted)' },
}

export default function UserManagement() {
  const { session } = useSession()
  const currentUserId = session?.user?.id

  const [staff, setStaff]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [invEmail, setInvEmail]   = useState('')
  const [invName, setInvName]     = useState('')
  const [invRole, setInvRole]     = useState('cashier')
  const [inviting, setInviting]   = useState(false)
  const [invMsg, setInvMsg]       = useState(null)
  const [updatingId, setUpdatingId] = useState(null)

  async function fetchStaff() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .order('created_at', { ascending: true })
    setStaff(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchStaff() }, [])

  async function changeRole(id, newRole) {
    setUpdatingId(id)
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id)
    if (error) {
      // Re-read the actual DB value so the dropdown snaps back on failure
      await fetchStaff()
    } else {
      setStaff(prev => prev.map(s => s.id === id ? { ...s, role: newRole } : s))
    }
    setUpdatingId(null)
  }

  async function sendInvite(e) {
    e.preventDefault()
    setInviting(true)
    setInvMsg(null)

    const { data, error } = await supabase.functions.invoke('invite-staff', {
      body: { email: invEmail.trim(), full_name: invName.trim(), role: invRole },
    })

    if (error || data?.error) {
      setInvMsg({ type: 'err', text: data?.error || error?.message || 'Invitation failed' })
    } else {
      setInvMsg({ type: 'ok', text: `Invitation sent to ${invEmail.trim()} — they'll receive an email to set their password.` })
      setInvEmail(''); setInvName(''); setInvRole('cashier')
    }
    setInviting(false)
  }

  return (
    <div className="settings-section">
      <h2>Staff accounts</h2>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      ) : (
        <div className="table" style={{ marginTop: 0 }}>
          <div className="tr th" style={{ gridTemplateColumns: '2fr 2.5fr 1.2fr 1.4fr' }}>
            <span>Name</span><span>Email</span><span>Role</span><span />
          </div>

          {staff.map(s => {
            const isSelf = s.id === currentUserId
            return (
              <div className="tr" key={s.id} style={{ gridTemplateColumns: '2fr 2.5fr 1.2fr 1.4fr', fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                  {s.full_name || '—'}
                  {isSelf && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, background: 'var(--accent-tint)',
                      color: 'var(--accent-text)', borderRadius: 99, padding: '1px 7px',
                      letterSpacing: '.05em',
                    }}>
                      YOU
                    </span>
                  )}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{s.email || '—'}</span>
                <span>
                  <span style={{
                    ...ROLE_BADGE[s.role],
                    fontSize: 11, fontWeight: 700, borderRadius: 99,
                    padding: '2px 10px', textTransform: 'capitalize', display: 'inline-block',
                  }}>
                    {s.role}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {isSelf ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                      Cannot change own role
                    </span>
                  ) : (
                    <select
                      value={s.role}
                      disabled={updatingId === s.id}
                      onChange={e => changeRole(s.id, e.target.value)}
                      style={{
                        padding: '4px 8px', borderRadius: 7, border: '1.5px solid var(--line)',
                        background: 'var(--surface)', color: 'var(--ink)',
                        fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)',
                        opacity: updatingId === s.id ? .5 : 1,
                      }}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Invite form */}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1.5px dashed var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--ink)' }}>
          Invite new staff member
        </div>
        <form onSubmit={sendInvite}>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <label className="field">
              <span>Full name</span>
              <input value={invName} onChange={e => setInvName(e.target.value)} placeholder="Jane Mwangi" />
            </label>
            <label className="field">
              <span>Email address</span>
              <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="jane@example.com" required />
            </label>
            <label className="field" style={{ flexBasis: 120, flexShrink: 0 }}>
              <span>Role</span>
              <select
                value={invRole}
                onChange={e => setInvRole(e.target.value)}
                style={{
                  padding: '10px 12px', border: '1.5px solid var(--line)',
                  borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)',
                  fontSize: 14, fontFamily: 'var(--font-ui)',
                }}
              >
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </label>
          </div>

          {invMsg && (
            <div style={{
              margin: '10px 0',
              background: invMsg.type === 'ok' ? 'var(--green-tint)' : 'var(--red-tint)',
              border: `1.5px solid ${invMsg.type === 'ok' ? 'rgba(26,122,72,.2)' : 'rgba(192,57,43,.25)'}`,
              borderRadius: 8, padding: '8px 12px', fontSize: 13,
              color: invMsg.type === 'ok' ? 'var(--green)' : 'var(--red)',
            }}>
              {invMsg.text}
            </div>
          )}

          <button className="btn pay" type="submit" disabled={inviting || !invEmail.trim()} style={{ marginTop: 12 }}>
            {inviting ? 'Sending…' : 'Send invitation email'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          The staff member receives an email with a link to set their password. Role changes take effect on their next sign-in.
        </p>
      </div>
    </div>
  )
}
