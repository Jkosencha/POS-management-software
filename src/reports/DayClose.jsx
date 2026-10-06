import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'
import { useSession } from '../auth/useSession'
import { todayKey as todayStr, startOfDay, startOfNextDay } from '../lib/dates'
import { Button } from '@/components/ui/button'

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
      const from = startOfDay(date).toISOString()
      const to   = startOfNextDay(date).toISOString()
      const [{ data: completedData }, { count: voids }] = await Promise.all([
        supabase
          .from('sales')
          .select('method, total, tendered, change')
          .gte('created_at', from).lt('created_at', to)
          .eq('status', 'completed'),
        supabase
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', from).lt('created_at', to)
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
      period_start: startOfDay(date).toISOString(),
      period_end:   startOfNextDay(date).toISOString(),
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
    <div className={`flex justify-between py-1.5 font-mono text-sm ${bold ? 'font-bold border-t border-dashed border-line mt-1' : ''} ${color || 'text-ink'}`}>
      <span className={`font-sans ${bold ? 'font-bold' : 'font-medium'}`}>{label}</span>
      <span>{value}</span>
    </div>
  )

  const box = 'rounded-md bg-surface-2 px-4 py-3.5 mb-4'
  const boxTitle = 'text-xs font-semibold text-muted mb-2.5'

  return (
    <Modal title="Close day: Z-report" onClose={onClose} className="max-w-[480px]">
      <div className="z-report-printable">

        <label className="field mb-4">
          <span>Period</span>
          <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} />
        </label>

        {loading ? (
          <p className="text-muted text-center py-5">Loading...</p>
        ) : (
          <>
            {/* revenue breakdown */}
            <div className={box}>
              <div className={boxTitle}>
                Sales ({sales.length} transaction{sales.length === 1 ? '' : 's'}{voidCount > 0 ? `, ${voidCount} void${voidCount > 1 ? 's' : ''}` : ''})
              </div>
              <Row label="Cash"   value={money(cashSales)} />
              <Row label="M-Pesa" value={money(mpesaSales)} />
              <Row label="Card"   value={money(cardSales)} />
              <Row label="TOTAL"  value={money(totalSales)} bold />
            </div>

            {/* cash reconciliation */}
            <div className={box}>
              <div className={boxTitle}>Cash reconciliation</div>
              <label className="field mb-2.5">
                <span>Opening float (cash in drawer at start of day)</span>
                <input
                  type="number" min="0" value={openingFloat}
                  onChange={e => setOpeningFloat(e.target.value)}
                  className="font-mono"
                />
              </label>
              <Row label="+ Cash sales" value={money(cashSales)} />
              <Row label="= Expected in drawer" value={money(expectedCash)} bold />

              <label className="field mt-3.5 mb-0">
                <span>Actual cash counted</span>
                <input
                  type="number" min="0"
                  value={actualCash}
                  onChange={e => setActualCash(e.target.value)}
                  placeholder="Count the drawer"
                  className="font-mono"
                />
              </label>

              {variance !== null && (
                <div className={`flex justify-between items-center mt-2.5 px-3.5 py-2.5 rounded-sm border ${
                  variance === 0 ? 'bg-green-tint border-green/25' : variance > 0 ? 'bg-amber-tint border-amber-warn/30' : 'bg-red-tint border-red/25'
                }`}>
                  <span className="font-bold text-[13px]">
                    {variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}
                  </span>
                  <span className={`font-mono font-bold text-base ${
                    variance === 0 ? 'text-green' : variance > 0 ? 'text-amber-warn' : 'text-red'
                  }`}>
                    {variance > 0 ? '+' : ''}{money(variance)}
                  </span>
                </div>
              )}
            </div>

            <label className="field">
              <span>Notes</span>
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Optional: issues, explanations"
              />
            </label>

            {error && <div className="alert-error">{error}</div>}

            {saved ? (
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-full bg-green-tint border border-green/25 py-2.5 text-center font-bold text-green">
                  Z-report saved
                </div>
                <Button variant="outline" className="flex-1 h-auto" onClick={handlePrint}>
                  Print
                </Button>
              </div>
            ) : (
              <div className="z-report-actions flex gap-2.5">
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button className="flex-1" disabled={saving} onClick={handleSave}>
                  {saving ? 'Saving...' : 'Save Z-report'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
