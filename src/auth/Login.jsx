import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from './useSession'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthShell from './AuthShell'

export default function Login() {
  const { blockedMsg, clearBlockedMsg } = useSession()
  const [mode, setMode] = useState('signin') // 'signin' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (m) => { setMode(m); setError(null); setInfo(null); clearBlockedMsg() }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    clearBlockedMsg()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) return setError(error.message)
    setInfo(`If ${email.trim()} has an account, a reset link is on its way. Open it on this device to choose a new password.`)
  }

  return (
    <AuthShell
      title="Sunrise Minimart"
      subtitle={mode === 'signin' ? 'Sign in to the point of sale' : 'Reset your password'}
    >
      {(error || blockedMsg) && <div className="alert-error">{error || blockedMsg}</div>}
      {info && <div className="alert-success">{info}</div>}

      {mode === 'signin' ? (
        <form onSubmit={handleSignIn} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            </div>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <Button type="submit" size="lg" className="w-full mt-2" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleForgot} className="flex flex-col gap-4">
          <p className="text-sm text-ink-2 m-0">
            Enter your account email and we'll send you a link to set a new password.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-email">Email</Label>
            <Input id="reset-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="email" />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading || !email.trim()}>
            {loading ? 'Sending...' : 'Send reset link'}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => switchMode('signin')}>
            Back to sign in
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
