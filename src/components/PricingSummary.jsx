import React from 'react'

/*
 * Shows the price of one unit (handy after entering a bulk "total paid")
 * and the profit per unit at the current selling price.
 */
export default function PricingSummary({ unitCost, price, money }) {
  const fmt = money || (n => `KSh ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`)
  const cost = unitCost === '' || unitCost == null ? null : Number(unitCost)
  if (cost == null || !(cost > 0)) return null

  const sell = price === '' || price == null ? null : Number(price)
  const profit = sell != null ? sell - cost : null
  const margin = sell > 0 ? profit / sell * 100 : null

  return (
    <div className="rounded-md bg-accent-tint/60 border border-accent/15 px-4 py-3.5 mb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink-2">Price of one</span>
        <span className="text-xl font-bold text-ink font-mono">{fmt(cost)}</span>
      </div>

      {profit != null && sell > 0 && (
        <div className={`text-[13px] mt-1.5 ${profit < 0 ? 'text-red' : 'text-ink-2'}`}>
          Selling at {fmt(sell)}:{' '}
          <strong className={profit < 0 ? 'text-red' : 'text-green'}>
            {profit < 0 ? 'loss' : 'profit'} of {fmt(Math.abs(Math.round(profit * 100) / 100))} each
          </strong>
          {margin != null && ` (${margin.toFixed(0)}% margin)`}
        </div>
      )}

    </div>
  )
}
