import React, { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, KeyRound, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'

const ROLES = ['cashier', 'manager', 'owner']
const ROLE_VARIANT = { owner: 'solid', manager: 'default', cashier: 'secondary' }
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

// supabase.functions.invoke hides the JSON body of non-2xx responses behind
// a generic "non-2xx status code" message; dig the real error back out.
async function functionError(error, data) {
  if (data?.error) return data.error
  try {
    const body = await error?.context?.json()
    if (body?.error) return body.error
  } catch { /* not JSON */ }
  return error?.message || 'Request failed'
}

function RoleSelect({ value, onChange, disabled }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {ROLES.map(r => <SelectItem key={r} value={r}>{cap(r)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function EditStaffModal({ member, isSelf, onClose, onSaved }) {
  const [name, setName]     = useState(member.full_name || '')
  const [role, setRole]     = useState(member.role)
  const [active, setActive] = useState(member.active !== false)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const changes = { full_name: name.trim() }
    if (!isSelf) { changes.role = role; changes.active = active }
    const { error } = await supabase.from('profiles').update(changes).eq('id', member.id)
    setSaving(false)
    if (error) return setError(error.message)
    onSaved(`${name.trim()} updated`)
  }

  return (
    <Modal title="Edit staff member" description={member.email} onClose={onClose}>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        {error && <div className="alert-error mb-0">{error}</div>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="staff-name">Full name</Label>
          <Input id="staff-name" autoFocus value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Role</Label>
          <RoleSelect value={role} onChange={setRole} disabled={isSelf} />
          {isSelf && <span className="text-xs text-muted">You can't change your own role.</span>}
        </div>
        <div className="flex items-center justify-between gap-4 rounded-sm bg-surface-2 px-3.5 py-3">
          <div>
            <div className="text-sm font-semibold text-ink">Active</div>
            <div className="text-xs text-muted">Inactive staff can't sign in.</div>
          </div>
          <Switch checked={active} onCheckedChange={setActive} disabled={isSelf} />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function UserManagement() {
  const { session } = useSession()
  const currentUserId = session?.user?.id

  const [staff, setStaff]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState(null)
  const [deleting, setDeleting]   = useState(null)
  const [toast, setToast]         = useState(null)

  const [invEmail, setInvEmail]   = useState('')
  const [invName, setInvName]     = useState('')
  const [invRole, setInvRole]     = useState('cashier')
  const [inviting, setInviting]   = useState(false)
  const [invMsg, setInvMsg]       = useState(null)

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Success message clears itself; errors stay until the next attempt
  useEffect(() => {
    if (invMsg?.type !== 'ok') return
    const id = setTimeout(() => setInvMsg(null), 5000)
    return () => clearTimeout(id)
  }, [invMsg])

  const fetchStaff = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    // Deleted staff keep a profile row for history; hide them here
    setStaff((data || []).filter(s => !s.deleted_at))
    setLoading(false)
  }, [])

  useEffect(() => { fetchStaff() }, [fetchStaff])

  async function sendReset(member) {
    const { error } = await supabase.auth.resetPasswordForEmail(member.email, {
      redirectTo: window.location.origin,
    })
    flash(error ? error.message : `Password reset link sent to ${member.email}`)
  }

  // Returns an error message for the confirm dialog, or nothing on success
  async function handleDelete() {
    const member = deleting
    const { error } = await supabase.rpc('delete_staff', { p_user_id: member.id })
    if (error) {
      return error.code === 'PGRST202'
        ? 'Run migration 009 in the Supabase SQL editor to enable deleting staff.'
        : error.message
    }
    flash(`${member.full_name || member.email} deleted`)
    fetchStaff()
  }

  async function sendInvite(e) {
    e.preventDefault()
    setInviting(true)
    setInvMsg(null)

    const { data, error } = await supabase.functions.invoke('invite-staff', {
      body: {
        email: invEmail.trim(),
        full_name: invName.trim(),
        role: invRole,
        redirect_to: window.location.origin,
      },
    })

    if (error || data?.error) {
      setInvMsg({ type: 'err', text: await functionError(error, data) })
    } else {
      setInvMsg({ type: 'ok', text: `Invitation sent to ${invEmail.trim()}. They'll get an email to set their password.` })
      setInvEmail(''); setInvName(''); setInvRole('cashier')
      fetchStaff()
    }
    setInviting(false)
  }

  return (
    <>
      <div className="table-card mb-4">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="max-md:hidden">Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="empty-grid">Loading...</TableCell></TableRow>
            )}
            {staff.map(s => {
              const isSelf = s.id === currentUserId
              const inactive = s.active === false
              return (
                <TableRow key={s.id} className={inactive ? 'opacity-55' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="size-8 rounded-full grid place-items-center shrink-0 bg-accent-tint text-accent-text text-xs font-bold">
                        {(s.full_name || s.email || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold flex items-center gap-1.5">
                          {s.full_name || '-'}
                          {isSelf && <Badge variant="outline" className="text-[10px] py-0">You</Badge>}
                          {inactive && <Badge variant="secondary" className="text-[10px] py-0">Inactive</Badge>}
                        </div>
                        <div className="text-xs text-muted md:hidden truncate">{s.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted text-[13px] max-md:hidden">{s.email || '-'}</TableCell>
                  <TableCell><Badge variant={ROLE_VARIANT[s.role]} className="capitalize">{s.role}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon-sm" variant="ghost" title="Send password reset link" onClick={() => sendReset(s)} disabled={!s.email}>
                        <KeyRound />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-accent hover:text-accent" onClick={() => setEditing(s)}>
                        <Pencil /> Edit
                      </Button>
                      {!isSelf && (
                        <Button size="sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={() => setDeleting(s)}>
                          <Trash2 /> Delete
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

      {/* Invite form */}
      <div className="settings-section">
        <h2>Invite a new staff member</h2>
        <form onSubmit={sendInvite} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_150px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-name">Full name</Label>
              <Input id="inv-name" value={invName} onChange={e => setInvName(e.target.value)} placeholder="Jane Mwangi" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-email">Email address</Label>
              <Input id="inv-email" type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="jane@example.com" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <RoleSelect value={invRole} onChange={setInvRole} />
            </div>
          </div>

          {invMsg && <div className={`${invMsg.type === 'ok' ? 'alert-success' : 'alert-error'} mb-0`}>{invMsg.text}</div>}

          <div>
            <Button type="submit" disabled={inviting || !invEmail.trim()}>
              <Send /> {inviting ? 'Sending...' : 'Send invitation email'}
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted mt-3 mb-0">
          They receive an email with a link to set their password. Role changes take effect the next time they sign in.
        </p>
      </div>

      {editing && (
        <EditStaffModal
          member={editing}
          isSelf={editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); flash(msg); fetchStaff() }}
        />
      )}

      <PasswordConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Delete ${deleting?.full_name || deleting?.email}?`}
        description="Their login is removed permanently and they can no longer sign in. Sales and stock history they recorded are kept. To block access temporarily, edit them and turn off Active instead."
        confirmLabel="Delete staff member"
        onConfirm={handleDelete}
      />

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
