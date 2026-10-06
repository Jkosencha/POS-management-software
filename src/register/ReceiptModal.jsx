import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Modal from '../components/Modal'
import { isBridgeAvailable, printViaEscPos } from '../lib/escposPrint'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

function ReceiptPaper({ sale, settings, money }) {
  const row = "rc-row"
  const rule = "rc-rule"
  return (
    <div className="receipt-paper">
      <div className="rp-store">{settings.store_name.toUpperCase()}</div>
      <div className="rp-meta">
        {new Date(sale.created_at).toLocaleString('en-KE')} · {sale.receipt_no}
      </div>
      <div className={rule} />
      {(sale.items || []).map((i, idx) => (
        <div className={row} key={idx}>
          <span>{i.qty} × {i.name}</span>
          <span>{money(i.line_total)}</span>
        </div>
      ))}
      <div className={rule} />
      {sale.discount_amt > 0 && (
        <div className={row}>
          <span>Discount ({sale.discount_pct}%)</span>
          <span>−{money(sale.discount_amt)}</span>
        </div>
      )}
      <div className={`${row} rc-total`}>
        <span>TOTAL</span><span>{money(sale.total)}</span>
      </div>
      <div className={row}><span>VAT incl.</span><span>{money(Number(sale.vat_amount).toFixed(2))}</span></div>
      <div className={row}>
        <span>{sale.method}{sale.mpesa_ref ? ` · ${sale.mpesa_ref}` : ''}</span>
        <span>{money(sale.tendered)}</span>
      </div>
      {sale.method === 'Cash' && (
        <div className={row}><span>Change</span><span>{money(sale.change)}</span></div>
      )}
      <div className={rule} />
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
          <div className="alert-warn">
            Saved offline. It will sync automatically when the internet is back.
          </div>
        )}
        <ReceiptPaper sale={sale} settings={settings} money={money} />
        <div className="flex gap-2.5 mt-3.5">
          <Button variant="outline" size="lg" className="flex-1" onClick={handlePrint}>
            <Printer /> Print
          </Button>
          <Button size="lg" className="flex-1" onClick={onClose}>
            {sale.id ? 'Done' : 'New sale'}
          </Button>
        </div>
      </Modal>

      {printing && printRoot && createPortal(
        <ReceiptPaper sale={sale} settings={settings} money={money} />,
        printRoot
      )}
    </>
  )
}
