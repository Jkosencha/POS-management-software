import React, { useState, useEffect } from 'react'

const round2 = n => Math.round(n * 100) / 100

/*
 * Buying price field. "Per unit" takes the price of one item; "Total paid"
 * takes what was paid for the whole quantity (e.g. 27 loaves for 1000) and
 * works out the unit price. Either way onChange receives the unit price as
 * a string ('' when unknown), which is what gets saved.
 *
 * qty: units being bought. Leave undefined to offer "Per unit" only.
 */
export default function BuyingPriceInput({ qty, value, onChange, money, label = 'Buying price' }) {
  const allowTotal = qty !== undefined
  const [mode, setMode]   = useState('unit')   // 'unit' | 'total'
  const [total, setTotal] = useState('')

  const units = Math.abs(Number(qty) || 0)
  const unitFromTotal = total !== '' && units > 0 ? round2(Number(total) / units) : null

  // In total mode the unit price follows the total and the quantity
  useEffect(() => {
    if (mode !== 'total') return
    onChange(unitFromTotal == null ? '' : String(unitFromTotal))
  }, [mode, unitFromTotal]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(next) {
    if (next === mode) return
    // Carry the figure across so switching doesn't lose what was typed
    if (next === 'total') setTotal(value !== '' && value != null && units > 0 ? String(round2(Number(value) * units)) : '')
    setMode(next)
  }

  const fmt = money || (n => `KSh ${n}`)

  return (
    <div className="field">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">
          {label}{mode === 'unit' ? ' per unit' : ', total paid'} (KSh)
        </span>
        {allowTotal && (
          <div className="flex shrink-0 rounded-full bg-surface-2 p-0.5 text-[11.5px] font-semibold" role="group" aria-label="Buying price entry">
            {[['unit', 'Per unit'], ['total', 'Total paid']].map(([m, text]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={`px-2.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${mode === m ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}
                onClick={() => switchMode(m)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'unit' ? (
        <input
          type="number" min="0" step="any"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="What you pay for one"
        />
      ) : (
        <>
          <input
            type="number" min="0" step="any"
            value={total}
            onChange={e => setTotal(e.target.value)}
            placeholder={units > 0 ? `What you paid for all ${units}` : 'What you paid in total'}
          />
          {units === 0 && (
            <span className="text-xs font-normal text-ink-2">Enter the quantity to work out the price of one.</span>
          )}
        </>
      )}
    </div>
  )
}
