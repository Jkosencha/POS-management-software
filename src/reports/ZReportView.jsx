import React, { useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'

function Row({ label, value, bold, className = '' }) {
  return (
    <div className={`flex justify-between py-1.5 font-mono text-sm ${bold ? 'font-bold border-t border-dashed border-line mt-1' : ''} ${className || 'text-ink'}`}>
      <span className={`font-sans ${bold ? 'font-bold' : 'font-medium'}`}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// Read-only view of a saved Z-report, with Print and (owner) Delete
export default function ZReportView({ report: d, money, canDelete, onClose, onDeleted }) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const v = d.variance == null ? null : Number(d.variance)
  const box = 'rounded-md bg-surface-2 px-4 py-3.5 mb-4'
  const boxTitle = 'text-xs font-semibold text-muted mb-2.5'

  function handlePrint() {
    document.body.classList.add('printing-zreport')
    setTimeout(() => {
      window.print()
      document.body.classList.remove('printing-zreport')
    }, 60)
  }

  // Returns an error message for the confirm dialog, or nothing on success
  async function handleDelete() {
    // RLS silently skips rows it won't delete, so check something was removed
    const { data, error } = await supabase.from('day_closes').delete().eq('id', d.id).select('id')
    if (error) return error.message
    if (!data?.length) return 'Not deleted. Only the owner can delete Z-reports (and migration 012 must be run).'
    onDeleted()
  }

  const day = new Date(d.period_start).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Modal title="Z-report" description={day} onClose={onClose} className="max-w-[480px]">
      <div className="text-xs text-muted mb-4">
        Closed {new Date(d.closed_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        {d.closer_name ? ` by ${d.closer_name}` : ''}
      </div>

      <div className={box}>
        <div className={boxTitle}>
          Sales ({d.sale_count} transaction{d.sale_count === 1 ? '' : 's'}{d.void_count > 0 ? `, ${d.void_count} void${d.void_count > 1 ? 's' : ''}` : ''})
        </div>
        <Row label="Cash"   value={money(d.cash_sales)} />
        <Row label="M-Pesa" value={money(d.mpesa_sales)} />
        <Row label="Card"   value={money(d.card_sales)} />
        <Row label="TOTAL"  value={money(d.total_sales)} bold />
      </div>

      <div className={box}>
        <div className={boxTitle}>Cash reconciliation</div>
        <Row label="Opening float" value={money(d.opening_float)} />
        <Row label="+ Cash sales" value={money(d.cash_sales)} />
        <Row label="= Expected in drawer" value={money(d.expected_cash)} bold />
        <Row label="Actual cash counted" value={d.actual_cash == null ? 'Not counted' : money(d.actual_cash)} />
        {v !== null && (
          <Row
            label={v === 0 ? 'Balanced' : v > 0 ? 'Over' : 'Short'}
            value={`${v > 0 ? '+' : ''}${money(v)}`}
            bold
            className={v === 0 ? 'text-green' : v > 0 ? 'text-amber-warn' : 'text-red'}
          />
        )}
      </div>

      {d.notes && (
        <div className="mb-4">
          <div className={boxTitle}>Notes</div>
          <p className="text-sm text-ink-2 m-0 whitespace-pre-wrap">{d.notes}</p>
        </div>
      )}

      <div className="z-report-actions flex gap-2.5">
        {canDelete && (
          <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>
            <Trash2 /> Delete
          </Button>
        )}
        <Button variant="outline" className="flex-1" onClick={handlePrint}><Printer /> Print</Button>
        <Button className="flex-1" onClick={onClose}>Done</Button>
      </div>

      <PasswordConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this Z-report?"
        description={`The saved close for ${day} is removed permanently. Sales are not affected; you can close the day again with the right figures.`}
        confirmLabel="Delete Z-report"
        onConfirm={handleDelete}
      />
    </Modal>
  )
}
