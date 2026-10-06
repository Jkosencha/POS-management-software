const PAGE = 1000  // Supabase's default max rows per request

/*
 * Supabase silently caps every response at 1000 rows, which would make
 * long-range totals (this month, this year) come out short. This pages
 * through the whole result. `build` must return a fresh query with a
 * stable order each time it's called, e.g.
 *   fetchAll(() => supabase.from('sales').select('*').gte(...).order('id'))
 */
export async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}
