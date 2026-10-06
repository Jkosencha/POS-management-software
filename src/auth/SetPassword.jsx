import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from './useSession'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthShell from './AuthShell'

export const MIN_PASSWORD = 8

// Shown after an invite or password-reset email link signs the user in
export default function SetPassword() {
  const { profile, mustSetPassword, clearMustSetPassword, signOut } = useSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && password !== confirm
  const valid = password.length >= MIN_PASSWORD && password === confirm

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) return setError(error.message)
    clearMustSetPassword()
  }

  const isInvite = mustSetPassword === 'invite'
  const firstName = (profile?.full_name || '').split(' ')[0]

  return (
    <AuthShell
      title={isInvite ? `Welcome${firstName ? `, ${firstName}` : ''}!` : 'Choose a new password'}
      subtitle={isInvite ? 'Set a password to finish creating your account' : 'Enter a new password for your account'}
    >
      {error && <div className="alert-error">{error}</div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoFocus autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} aria-invalid={tooShort || undefined} />
          <span className={`text-xs ${tooShort ? 'text-red' : 'text-muted'}`}>At least {MIN_PASSWORD} characters</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
          {mismatch && <span className="text-xs text-red">Passwords don't match</span>}
        </div>
        <Button type="submit" size="lg" className="w-full mt-1" disabled={!valid || saving}>
          {saving ? 'Saving...' : 'Save password'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => { clearMustSetPassword(); signOut() }}>
          Cancel and sign out
        </Button>
      </form>
    </AuthShell>
  )
}
