import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Modal from '../components/Modal'
import { isBridgeAvailable, printViaEscPos } from '../lib/escposPrint'

function ReceiptPaper({ sale, settings, money }) {
  return (
    <div className="receipt-paper">
      <div className="rp-store">{settings.store_name.toUpperCase()}</div>
      <div className="rp-meta">
        {new Date(sale.created_at).toLocaleString('en-KE')} · {sale.receipt_no}
      </div>
      <div className="rc-rule" />
      {(sale.items || []).map((i, idx) => (
        <div className="rc-row" key={idx}>
          <span>{i.qty} × {i.name}</span>
          <span>{money(i.line_total)}</span>
        </div>
      ))}
      <div className="rc-rule" />
      {sale.discount_amt > 0 && (
        <div className="rc-row">
          <span>Discount ({sale.discount_pct}%)</span>
          <span>−{money(sale.discount_amt)}</span>
        </div>
      )}
      <div className="rc-row rc-total"><span>TOTAL</span><span>{money(sale.total)}</span></div>
      <div className="rc-row"><span>VAT incl.</span><span>{money(Number(sale.vat_amount).toFixed(2))}</span></div>
      <div className="rc-row">
        <span>{sale.method}{sale.mpesa_ref ? ` · ${sale.mpesa_ref}` : ''}</span>
        <span>{money(sale.tendered)}</span>
      </div>
      {sale.method === 'Cash' && (
        <div className="rc-row"><span>Change</span><span>{money(sale.change)}</span></div>
      )}
      <div className="rc-rule" />
      <div className="rp-footer">{settings.receipt_footer}</div>
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
            background: '#fff8ec', border: '1.5px solid var(--amber)', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#7a5000', fontWeight: 600,
          }}>
            Saved offline — will sync automatically when internet is restored.
          </div>
        )}
        <ReceiptPaper sale={sale} settings={settings} money={money} />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={handlePrint}>
            🖨 Print
          </button>
          <button className="btn pay" style={{ flex: 1 }} onClick={onClose}>
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
