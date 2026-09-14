import React, { useState, useEffect, useRef } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'

// How long to wait for Safaricom callback before showing manual fallback
const STK_TIMEOUT_SECS = 60

export default function PaymentModal({ total, money, session, onClose, onComplete }) {
  const [method, setMethod]         = useState('Cash')
  const [tendered, setTendered]     = useState('')
  const [ref, setRef]               = useState('')

  // STK push state
  const [phone, setPhone]           = useState('')
  const [stkPhase, setStkPhase]     = useState('idle') // idle | sending | waiting | success | failed
  const [stkError, setStkError]     = useState('')
  const [stkRef, setStkRef]         = useState('')    // confirmed M-Pesa code
  const [countdown, setCountdown]   = useState(STK_TIMEOUT_SECS)
  const countdownRef                = useRef(null)
  const realtimeChRef               = useRef(null)

  const t      = Number(tendered) || 0
  const change = t - total

  const quick = [...new Set([
    total,
    Math.ceil(total / 50) * 50,
    Math.ceil(total / 100) * 100,
    Math.ceil(total / 500) * 500,
  ])]

  const canConfirm = method === 'Cash'
    ? t >= total
    : method === 'M-Pesa'
      ? stkPhase === 'success' || ref.trim().length > 0
      : true // Card: manual confirm

  // ---- STK push -------------------------------------------------------

  async function sendStk() {
    setStkError('')
    setStkPhase('sending')
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk', {
        body: {
          phone,
          amount:     total,
          cashier_id: session?.user?.id,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)

      const { request_id } = data
      setStkPhase('waiting')
      startCountdown()
      subscribeRealtime(request_id)

    } catch (err) {
      setStkPhase('failed')
      setStkError(err.message || 'Could not send M-Pesa prompt')
    }
  }

  function startCountdown() {
    setCountdown(STK_TIMEOUT_SECS)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          // Only time-out if still waiting (not already success/failed)
          setStkPhase(p => p === 'waiting' ? 'timeout' : p)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function subscribeRealtime(requestId) {
    // Unsubscribe from any previous channel
    if (realtimeChRef.current) {
      supabase.removeChannel(realtimeChRef.current)
    }

    const ch = supabase
      .channel(`mpesa-${requestId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'mpesa_requests',
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          const row = payload.new
          if (row.status === 'success') {
            clearInterval(countdownRef.current)
            setStkRef(row.mpesa_ref || '')
            setStkPhase('success')
          } else if (row.status === 'failed') {
            clearInterval(countdownRef.current)
            setStkError(row.result_desc || 'Payment declined by M-Pesa')
            setStkPhase('failed')
          }
        }
      )
      .subscribe()

    realtimeChRef.current = ch
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (realtimeChRef.current) supabase.removeChannel(realtimeChRef.current)
    }
  }, [])

  // Auto-confirm after STK success (after short delay so user sees it)
  useEffect(() => {
    if (stkPhase !== 'success') return
    const id = setTimeout(() => {
      onComplete({ method: 'M-Pesa', tendered: total, ref: stkRef })
    }, 1800)
    return () => clearTimeout(id)
  }, [stkPhase, stkRef]) // eslint-disable-line

  // Reset STK state when switching away from M-Pesa
  useEffect(() => {
    if (method !== 'M-Pesa') {
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (realtimeChRef.current) supabase.removeChannel(realtimeChRef.current)
      setStkPhase('idle')
      setStkError('')
      setStkRef('')
    }
  }, [method])

  // ---- render ----------------------------------------------------------

  const fieldLabel = "text-xs font-bold text-muted uppercase tracking-[.06em]"
  const fieldInput = "border-[1.5px] border-line rounded-sm bg-surface text-ink outline-none transition-all px-3 py-2.5 focus:border-accent"

  return (
    <Modal title="Take payment" onClose={onClose}>
      <div className="font-mono text-4xl font-bold text-center text-accent" style={{ padding: '4px 0 16px' }}>{money(total)}</div>
      <div className="flex gap-2 mb-4">
        {['Cash', 'M-Pesa', 'Card'].map(m => (
          <button
            key={m}
            className={`flex-1 rounded-[10px] border-[1.5px] font-bold text-[13.5px] transition-all ${
              method === m ? 'bg-accent-tint border-accent text-accent-text' : 'border-line bg-surface-2 text-ink-2 hover:border-accent hover:text-accent'
            }`}
            style={{ padding: 10 }}
            onClick={() => setMethod(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {method === 'Cash' && (
        <>
          <label className="flex flex-col gap-1.25 mb-3">
            <span className={fieldLabel}>Cash received</span>
            <input
              className={fieldInput}
              type="number"
              autoFocus
              value={tendered}
              onChange={e => setTendered(e.target.value)}
              placeholder="0"
            />
          </label>
          <div className="flex gap-2 flex-wrap mb-2.5">
            {quick.map(q => (
              <button
                key={q}
                className="border-[1.5px] border-line bg-surface-2 rounded-sm font-mono text-[12.5px] font-semibold text-ink-2 transition-all hover:border-accent hover:text-accent hover:bg-accent-tint"
                style={{ padding: '7px 12px' }}
                onClick={() => setTendered(String(q))}
              >
                {money(q)}
              </button>
            ))}
          </div>
          <div className={`font-mono font-bold text-[17px] ${change < 0 ? 'text-red' : 'text-green'}`} style={{ padding: '4px 0' }}>
            {change >= 0 ? `Change: ${money(change)}` : `Short by ${money(-change)}`}
          </div>
        </>
      )}

      {method === 'M-Pesa' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>

          {/* ---- idle: phone entry + send button ---- */}
          {(stkPhase === 'idle' || stkPhase === 'failed' || stkPhase === 'timeout') && (
            <>
              <label className="flex flex-col gap-1.25 mb-3">
                <span className={fieldLabel}>Customer phone number</span>
                <input
                  className={fieldInput}
                  autoFocus
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="07xx xxx xxx"
                />
              </label>

              {stkError && (
                <div style={{
                  background: 'var(--red-tint)', border: '1.5px solid var(--red)',
                  borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--red)',
                }}>
                  {stkError}
                </div>
              )}

              <button
                className="border-0 rounded-[10px] font-bold text-sm text-white w-full disabled:bg-surface-3 disabled:text-muted disabled:cursor-not-allowed"
                style={{
                  padding: '11px 16px',
                  background: phone.replace(/\D/g, '').length < 9 ? undefined : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
                  boxShadow: phone.replace(/\D/g, '').length < 9 ? undefined : '0 2px 8px rgba(184,150,58,.22), 0 4px 16px rgba(184,150,58,.14)',
                }}
                disabled={phone.replace(/\D/g, '').length < 9}
                onClick={sendStk}
              >
                Send M-Pesa prompt
              </button>

              <div style={{ textAlign: 'center', color: '#8d948a', fontSize: 12 }}>
                or enter reference manually:
              </div>
              <label className="flex flex-col gap-1.25 mb-3">
                <span className={fieldLabel}>M-Pesa reference</span>
                <input
                  className={fieldInput}
                  value={ref}
                  onChange={e => setRef(e.target.value)}
                  placeholder="e.g. RKT4XYZ123"
                />
              </label>
            </>
          )}

          {/* ---- sending: spinner ---- */}
          {stkPhase === 'sending' && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#5a9e78' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
              <div style={{ fontWeight: 600 }}>Sending prompt to {phone}…</div>
            </div>
          )}

          {/* ---- waiting: countdown ---- */}
          {stkPhase === 'waiting' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 42, fontWeight: 700, color: '#5a9e78', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {countdown}s
              </div>
              <div style={{ marginTop: 8, color: '#4a6160', fontSize: 14 }}>
                Waiting for customer to confirm on their phone…
              </div>
              <div style={{ marginTop: 16, color: '#8d948a', fontSize: 12 }}>
                Customer should see a PIN prompt for {money(total)}
              </div>
              <button
                style={{
                  marginTop: 14, background: 'none', border: '1.5px solid #c5ccc5',
                  borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontSize: 13,
                  color: '#6a7570',
                }}
                onClick={() => {
                  clearInterval(countdownRef.current)
                  if (realtimeChRef.current) supabase.removeChannel(realtimeChRef.current)
                  setStkPhase('timeout')
                  setStkError('Prompt cancelled — enter reference manually or resend.')
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* ---- success ---- */}
          {stkPhase === 'success' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 700, color: '#2e7d52', fontSize: 16 }}>
                Payment confirmed!
              </div>
              <div style={{
                marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 18,
                color: '#2e7d52', letterSpacing: 1,
              }}>
                {stkRef}
              </div>
              <div style={{ color: '#8d948a', fontSize: 12, marginTop: 6 }}>
                Completing sale…
              </div>
            </div>
          )}
        </div>
      )}

      {method === 'Card' && (
        <p className="text-muted text-sm m-0" style={{ padding: '12px 0' }}>
          Process the card on your terminal, then confirm here.
        </p>
      )}

      {/* Bottom confirm — only shown when not in STK flow */}
      {(method !== 'M-Pesa' || stkPhase === 'idle' || stkPhase === 'failed' || stkPhase === 'timeout') && (
        <button
          className="border-0 rounded-[10px] font-bold text-sm text-white w-full disabled:bg-surface-3 disabled:text-muted disabled:cursor-not-allowed"
          style={{
            padding: '11px 16px',
            marginTop: method === 'M-Pesa' ? 0 : 12,
            background: !canConfirm ? undefined : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
            boxShadow: !canConfirm ? undefined : '0 2px 8px rgba(184,150,58,.22), 0 4px 16px rgba(184,150,58,.14)',
          }}
          disabled={!canConfirm}
          onClick={() => onComplete({
            method,
            tendered: method === 'Cash' ? t : total,
            ref:      method === 'M-Pesa' ? ref.trim() : '',
          })}
        >
          {method === 'M-Pesa' && ref.trim() ? 'Confirm with reference' : 'Confirm payment'}
        </button>
      )}
    </Modal>
  )
}
