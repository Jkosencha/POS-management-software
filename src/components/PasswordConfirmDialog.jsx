import React, { useState, useEffect } from 'react'
import { verifyPassword } from '../lib/verifyPassword'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/*
 * Confirmation for destructive actions: the user must re-enter their own
 * password. onConfirm runs only after the password checks out; it may be
 * async and may return an error message to show in the dialog.
 * Pass canConfirm={false} to show the explanation with only a Close button.
 */
export default function PasswordConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Delete', canConfirm = true, onConfirm,
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => { if (open) { setPassword(''); setError(null); setBusy(false) } }, [open])

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const authError = await verifyPassword(password)
    if (authError) { setBusy(false); return setError(authError) }
    const actionError = await onConfirm()
    setBusy(false)
    if (actionError) return setError(actionError)
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <AlertDialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          {canConfirm && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Enter your password to confirm</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
          )}

          {error && <div className="alert-error mb-0">{error}</div>}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>{canConfirm ? 'Cancel' : 'Close'}</AlertDialogCancel>
            {canConfirm && (
              <Button type="submit" variant="destructive" disabled={!password || busy}>
                {busy ? 'Checking...' : confirmLabel}
              </Button>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
