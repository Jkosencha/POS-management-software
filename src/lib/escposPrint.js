// Tries to print via the local ESC/POS bridge (Node service on the till PC).
// Falls back gracefully — callers should always have a CSS-print fallback.

const BRIDGE_URL = 'http://127.0.0.1:8080'

export async function isBridgeAvailable() {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function printViaEscPos(sale, settings) {
  const body = {
    store_name: settings.store_name,
    meta:       `${new Date(sale.created_at).toLocaleString('en-KE')} · ${sale.receipt_no}`,
    items:      sale.items,
    subtotal:   sale.subtotal,
    discount_pct: sale.discount_pct,
    discount_amt: sale.discount_amt,
    total:      sale.total,
    vat_amount: sale.vat_amount,
    method:     sale.method,
    tendered:   sale.tendered,
    change:     sale.change,
    mpesa_ref:  sale.mpesa_ref || '',
    footer:     settings.receipt_footer,
    currency:   settings.currency,
  }

  const res = await fetch(`${BRIDGE_URL}/print`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(4000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Bridge error ${res.status}: ${text}`)
  }
  return res.json()
}
