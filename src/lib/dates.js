// Local-time date helpers. Supabase stores timestamptz in UTC, so always
// convert local day boundaries with toISOString() before querying.

export const pad2 = n => String(n).padStart(2, '0')

// 'YYYY-MM-DD' for a Date in the device's local time zone
export const localKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

export const todayKey = () => localKey(new Date())

export function daysAgoKey(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localKey(d)
}

// Local midnight at the start of a 'YYYY-MM-DD' day
export const startOfDay = key => new Date(`${key}T00:00:00`)

// Local midnight at the start of the day AFTER a 'YYYY-MM-DD' day
export function startOfNextDay(key) {
  const d = startOfDay(key)
  d.setDate(d.getDate() + 1)
  return d
}
