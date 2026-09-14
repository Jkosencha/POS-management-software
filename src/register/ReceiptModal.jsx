import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Modal from '../components/Modal'
import { isBridgeAvailable, printViaEscPos } from '../lib/escposPrint'

function ReceiptPaper({ sale, settings, money }) {
  const row = "rc-row flex justify-between text-sm text-ink"
  const rule = "rc-rule border-0 border-t-[1.5px] border-dashed border-line my-2.5"
  return (
    <div className="receipt-paper font-mono bg-white text-[#111] border border-line rounded-sm p-4">
      <div className="rp-store text-center font-bold text-[14.5px] tracking-[.12em]">{settings.store_name.toUpperCase()}</div>
      <div className="rp-meta text-center text-[11px] text-[#666] mt-0.75">
        {new Date(sale.created_at).toLocaleString('en-KE')} · {sale.receipt_no}
      </div>
      <div className={rule} />
      {(sale.items || []).map((i, idx) => (
        <div className={row} style={{ padding: '3px 0' }} key={idx}>
          <span>{i.qty} × {i.name}</span>
          <span>{money(i.line_total)}</span>
        </div>
      ))}
      <div className={rule} />
      {sale.discount_amt > 0 && (
        <div className={row} style={{ padding: '3px 0' }}>
          <span>Discount ({sale.discount_pct}%)</span>
          <span>−{money(sale.discount_amt)}</span>
        </div>
      )}
      <div className={`${row} rc-total text-xl font-bold text-accent`} style={{ padding: '6px 0 2px' }}>
        <span>TOTAL</span><span>{money(sale.total)}</span>
      </div>
      <div className={row} style={{ padding: '3px 0' }}><span>VAT incl.</span><span>{money(Number(sale.vat_amount).toFixed(2))}</span></div>
      <div className={row} style={{ padding: '3px 0' }}>
        <span>{sale.method}{sale.mpesa_ref ? ` · ${sale.mpesa_ref}` : ''}</span>
        <span>{money(sale.tendered)}</span>
      </div>
      {sale.method === 'Cash' && (
        <div className={row} style={{ padding: '3px 0' }}><span>Change</span><span>{money(sale.change)}</span></div>
      )}
      <div className={rule} />
      <div className="rp-footer text-center text-xs text-[#666] pt-1">{settings.receipt_footer}</div>
    </div>
  )
}

export default function ReceiptModal({ sale, settings, money, onClose }) {
  const [printing, setPrinting] = useState(false)

  const handlePrint = useCallback(async () => {
    // Try silent ESC/POS bridge first (no dialog, kicks cash drawer)
    const available = await isBridgeAvailable()
    if (available) {
      try {
        await printViaEscPos(sale, settings)
        return  // silent print succeeded
      } catch (e) {
        console.warn('ESC/POS bridge failed, falling back to browser print:', e.message)
      }
    }
    // Fallback: CSS print via portal
    setPrinting(true)
  }, [sale, settings])

  // Trigger window.print() after the portal has rendered into #print-root
  useEffect(() => {
    if (!printing) return
    const id = setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 60)
    return () => clearTimeout(id)
  }, [printing])

  const printRoot = document.getElementById('print-root')

  return (
    <>
      <Modal title={`Receipt ${sale.receipt_no}`} onClose={onClose}>
        {sale.offline && (
          <div style={{
            background: 'var(--amber-tint)', border: '1.5px solid var(--amber-warn)', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--amber-text)', fontWeight: 600,
          }}>
            Saved offline — will sync automatically when internet is restored.
          </div>
        )}
        <ReceiptPaper sale={sale} settings={settings} money={money} />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="rounded-[10px] font-bold text-sm bg-transparent border-[1.5px] border-line text-muted hover:border-red hover:text-red"
            style={{ flex: 1, padding: '11px 16px' }}
            onClick={handlePrint}
          >
            🖨 Print
          </button>
          <button
            className="border-0 rounded-[10px] font-bold text-sm text-white"
            style={{
              flex: 1, padding: '11px 16px',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
              boxShadow: '0 2px 8px rgba(184,150,58,.22), 0 4px 16px rgba(184,150,58,.14)',
            }}
            onClick={onClose}
          >
            New sale
          </button>
        </div>
      </Modal>

      {printing && printRoot && createPortal(
        <ReceiptPaper sale={sale} settings={settings} money={money} />,
        printRoot
      )}
    </>
  )
}
