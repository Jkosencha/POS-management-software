import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen grid place-items-center bg-bg"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 15% 85%, rgba(47,158,99,.08) 0%, transparent 60%),' +
          'radial-gradient(ellipse 60% 80% at 85% 15%, rgba(184,150,58,.07) 0%, transparent 60%)',
      }}
    >
      <div className="bg-surface border border-line rounded-lg shadow-md w-full max-w-[390px] py-10 px-9">
        <div className="flex flex-col items-center gap-2.5 mb-8">
          <div className="w-14 h-14 rounded-md flex items-center justify-center font-extrabold text-[28px] shadow-md bg-sb-active-bg text-sb-active-fg">
            <span>S</span>
          </div>
          <h1 className="m-0 text-[22px] font-extrabold text-ink tracking-tight">Sunrise Minimart</h1>
          <p className="m-0 text-[13px] text-muted">Point of Sale</p>
        </div>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-tint border border-red/25 rounded-sm px-3 py-2.5 mb-3.5 text-sm text-red">
              {error}
            </div>
          )}
          <label className="flex flex-col gap-1.25 mb-3">
            <span className="text-xs font-bold text-muted uppercase tracking-[.06em]">Email</span>
            <input
              className="border-[1.5px] border-line rounded-sm bg-surface text-ink outline-none transition-all px-3 py-2.5 focus:border-accent"
              style={{ boxShadow: 'none' }}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1.25 mb-3">
            <span className="text-xs font-bold text-muted uppercase tracking-[.06em]">Password</span>
            <input
              className="border-[1.5px] border-line rounded-sm bg-surface text-ink outline-none transition-all px-3 py-2.5 focus:border-accent"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button
            className="border-0 rounded-[10px] font-bold text-sm text-white w-full mt-3.5 disabled:bg-surface-3 disabled:text-muted disabled:cursor-not-allowed"
            style={{
              padding: '11px 16px',
              background: loading ? undefined : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
              boxShadow: loading ? undefined : '0 2px 8px rgba(184,150,58,.22), 0 4px 16px rgba(184,150,58,.14)',
            }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
