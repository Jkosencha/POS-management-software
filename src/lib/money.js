export function formatMoney(n, currency = 'KSh') {
  const val = Number(n) || 0
  return `${currency} ${val.toLocaleString('en-KE', {
    minimumFractionDigits: val % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

// VAT is included in shelf prices: extract the VAT portion from a total
export function vatFromTotal(total, taxRate) {
  return total * (taxRate / (100 + taxRate))
}
