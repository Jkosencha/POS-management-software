import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DayClose({ money, onClose }) {
  const { session } = useSession()

  const [date, setDate]           = useState(todayStr())
  const [sales, setSales]         = useState([])
  const [voidCount, setVoidCount] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [openingFloat, setOpeningFloat] = useState('0')
  const [actualCash, setActualCash]     = useState('')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    async function fetchDay() {
      setLoading(true)
      const from = `${date}T00:00:00`
      const to   = `${date}T23:59:59`
      const [{ data: completedData }, { count: voids }] = await Promise.all([
        supabase
          .from('sales')
          .select('method, total, tendered, change')
          .gte('created_at', from).lte('created_at', to)
          .eq('status', 'completed'),
        supabase
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', from).lte('created_at', to)
          .eq('status', 'voided'),
      ])
      setSales(completedData || [])
      setVoidCount(voids || 0)
      setLoading(false)
    }
    fetchDay()
  }, [date])

  /* ---- derived numbers ---- */
  const cashSales  = sales.filter(s => s.method === 'Cash').reduce((n, s) => n + Number(s.total), 0)
  const mpesaSales = sales.filter(s => s.method === 'M-Pesa').reduce((n, s) => n + Number(s.total), 0)
  const cardSales  = sales.filter(s => s.method === 'Card').reduce((n, s) => n + Number(s.total), 0)
  const totalSales = cashSales + mpesaSales + cardSales

  const float        = Number(openingFloat) || 0
  const expectedCash = float + cashSales
  const actual       = actualCash !== '' ? Number(actualCash) : null
  const variance     = actual !== null ? actual - expectedCash : null

  async function handleSave() {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('day_closes').insert({
      closed_by:    session?.user?.id,
      period_start: `${date}T00:00:00`,
      period_end:   `${date}T23:59:59`,
      opening_float: float,
      cash_sales:    cashSales,
      mpesa_sales:   mpesaSales,
      card_sales:    cardSales,
      total_sales:   totalSales,
      sale_count:    sales.length,
      void_count:    voidCount,
      expected_cash: expectedCash,
      actual_cash:   actual,
      variance,
      notes:         notes.trim() || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setSaved(true)
    setSaving(false)
  }

  function handlePrint() {
    document.body.classList.add('printing-zreport')
    setTimeout(() => {
      window.print()
      document.body.classList.remove('printing-zreport')
    }, 60)
  }

  const Row = ({ label, value, bold, color }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '5px 0', fontWeight: bold ? 700 : 400,
      color: color || 'var(--ink)',
      borderTop: bold ? '1.5px dashed var(--line)' : 'none',
      marginTop: bold ? 4 : 0,
      fontFamily: 'var(--font-mono)', fontSize: 14,
    }}>
      <span style={{ fontFamily: 'var(--font-ui)', fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span>{value}</span>
    </div>
  )

  return (
    <Modal title="Close Day — Z-Report" onClose={onClose}>
      <div className="z-report-printable">

        {/* date picker */}
        <label className="field" style={{ marginBottom: 16 }}>
          <span>Period</span>
          <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} />
        </label>

        {loading ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        ) : (
          <>
            {/* revenue breakdown */}
            <div style={{
              background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                Sales ({sales.length} transaction{sales.length === 1 ? '' : 's'}{voidCount > 0 ? `, ${voidCount} void${voidCount > 1 ? 's' : ''}` : ''})
              </div>
              <Row label="Cash"   value={money(cashSales)} />
              <Row label="M-Pesa" value={money(mpesaSales)} />
              <Row label="Card"   value={money(cardSales)} />
              <Row label="TOTAL"  value={money(totalSales)} bold />
            </div>

            {/* cash reconciliation */}
            <div style={{
              background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                Cash reconciliation
              </div>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Opening float (cash in drawer at start of day)</span>
                <input
                  type="number" min="0" value={openingFloat}
                  onChange={e => setOpeningFloat(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </label>
              <Row label="+ Cash sales" value={money(cashSales)} />
              <Row label="= Expected in drawer" value={money(expectedCash)} bold />

              <label className="field" style={{ marginTop: 14, marginBottom: 0 }}>
                <span>Actual cash counted</span>
                <input
                  type="number" min="0"
                  value={actualCash}
                  onChange={e => setActualCash(e.target.value)}
                  placeholder="Count the drawer…"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </label>

              {variance !== null && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 10, padding: '10px 14px', borderRadius: 8,
                  background: variance === 0 ? 'var(--green-tint)' : variance > 0 ? '#fff8ec' : 'var(--red-tint)',
                  border: `1.5px solid ${variance === 0 ? 'rgba(26,122,72,.2)' : variance > 0 ? 'rgba(208,140,10,.25)' : 'rgba(192,57,43,.25)'}`,
                }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16,
                    color: variance === 0 ? 'var(--green)' : variance > 0 ? 'var(--amber-warn)' : 'var(--red)',
                  }}>
                    {variance > 0 ? '+' : ''}{money(variance)}
                  </span>
                </div>
              )}
            </div>

            <label className="field">
              <span>Notes</span>
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Optional — issues, explanations…"
              />
            </label>

            {error && (
              <div style={{
                background: 'var(--red-tint)', border: '1.5px solid rgba(192,57,43,.3)',
                borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: 'var(--red)',
              }}>
                {error}
              </div>
            )}

            {saved ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{
                  flex: 1, background: 'var(--green-tint)', border: '1.5px solid rgba(26,122,72,.25)',
                  borderRadius: 10, padding: '12px 16px', textAlign: 'center',
                  fontWeight: 700, color: 'var(--green)',
                }}>
                  Z-report saved ✓
                </div>
                <button className="btn ghost" onClick={handlePrint} style={{ flex: 1 }}>
                  Print
                </button>
              </div>
            ) : (
              <div className="z-report-actions" style={{ display: 'flex', gap: 10 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn pay" style={{ flex: 1 }}
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : 'Save Z-report'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
