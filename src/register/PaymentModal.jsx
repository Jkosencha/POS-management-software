import React, { useState } from 'react'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'

const METHOD_NOTE = {
  'M-Pesa': 'Check the Pochi la Biashara confirmation on the shop phone, then confirm here.',
  Card:     'Process the card on your terminal, then confirm here.',
}

export default function PaymentModal({ total, money, onClose, onComplete }) {
  const [method, setMethod]     = useState('Cash')
  const [tendered, setTendered] = useState('')

  const t      = Number(tendered) || 0
  const change = t - total

  const quick = [...new Set([
    total,
    Math.ceil(total / 50) * 50,
    Math.ceil(total / 100) * 100,
    Math.ceil(total / 500) * 500,
  ])]

  // M-Pesa and Card are just recorded: no phone number or reference needed
  const canConfirm = method === 'Cash' ? t >= total : true

  const confirm = () => onComplete({
    method,
    tendered: method === 'Cash' ? t : total,
    ref: '',
  })

  return (
    <Modal title="Take payment" onClose={onClose}>
      <div className="font-mono text-4xl font-bold text-center text-accent pb-4">{money(total)}</div>
      <div className="flex gap-2 mb-4">
        {['Cash', 'M-Pesa', 'Card'].map(m => (
          <button
            key={m}
            className={`flex-1 rounded-full border py-2.5 font-semibold text-[13.5px] transition-all ${
              method === m ? 'bg-accent border-accent text-white' : 'border-line bg-surface-2 text-ink-2 hover:border-accent hover:text-accent'
            }`}
            onClick={() => setMethod(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {method === 'Cash' ? (
        <>
          <label className="field">
            <span>Cash received</span>
            <input
              type="number"
              autoFocus
              value={tendered}
              onChange={e => setTendered(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canConfirm) confirm() }}
              placeholder="0"
            />
          </label>
          <div className="flex gap-2 flex-wrap mb-2.5">
            {quick.map(q => (
              <button
                key={q}
                className="border border-line bg-surface-2 rounded-full font-mono text-[12.5px] font-semibold text-ink-2 transition-all hover:border-accent hover:text-accent hover:bg-accent-tint px-3 py-1.5"
                onClick={() => setTendered(String(q))}
              >
                {money(q)}
              </button>
            ))}
          </div>
          <div className={`font-mono font-bold text-[17px] py-1 ${change < 0 ? 'text-red' : 'text-green'}`}>
            {change >= 0 ? `Change: ${money(change)}` : `Short by ${money(-change)}`}
          </div>
        </>
      ) : (
        <p className="text-muted text-sm m-0 py-3">{METHOD_NOTE[method]}</p>
      )}

      <Button size="lg" className="w-full mt-3" disabled={!canConfirm} onClick={confirm}>
        {method === 'Cash' ? 'Confirm payment' : `Paid with ${method}`}
      </Button>
    </Modal>
  )
}
