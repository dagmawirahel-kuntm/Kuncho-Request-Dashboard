import type { PostgrestError } from '@supabase/supabase-js'

// The API returns at most 1,000 rows per request and drops the rest without
// an error. A list read in one go is fine until its table outgrows that —
// then the newest rows quietly go missing (request lines vanished from the
// purchase-order picker once order_items passed 1,000). This reads every
// row, a page at a time.
//
// `page(from, to)` must build a fresh query with a stable order (order by a
// unique column such as id) and end in `.range(from, to)`.
const PAGE = 1000

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}
