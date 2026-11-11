import { supabase } from '@/lib/supabase'

/** Where a matching round stopped, as auto_reconcile_bank_lines_round returns it. */
export interface MatchRound {
  matched: number
  tried: number
  more: boolean
  after_date: string | null
  after_no: number | null
  after_line: string | null
}

// Matching is the heaviest thing the app asks of the database. On 11 Nov a
// run of back-to-back 4-second rounds kept it saturated until it stopped
// answering everyone. So each round now takes a short slice, the loop
// pauses between rounds so other people's requests get through, and a
// round that comes back slow ends the run: the database is struggling.
const ROUND_MS = 1500
const PAUSE_MS = 600
const BUSY_MS = 8000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Match bank lines automatically, a short round at a time, carrying on from
 * where the last round stopped until every line has been tried. Pass the
 * round the import already ran to carry on from it. `stopped` says the run
 * ended early because the database was slow; pressing again carries on.
 */
export async function autoMatchBankLines({ importId = null, accountId = null, from, onProgress }: {
  importId?: string | null
  accountId?: string | null
  from?: MatchRound | null
  onProgress?: (p: { matched: number; tried: number }) => void
}): Promise<{ matched: number; tried: number; stopped: boolean }> {
  let matched = from?.matched ?? 0
  let tried = from?.tried ?? 0
  let at: MatchRound | null = from ?? null
  for (let i = 0; i < 500 && (at === null || at.more); i++) {
    if (i > 0) await sleep(PAUSE_MS)
    const started = Date.now()
    const { data, error } = await supabase.rpc('auto_reconcile_bank_lines_round', {
      p_import_id: importId, p_account_id: accountId,
      p_after_date: at?.after_date ?? null, p_after_no: at?.after_no ?? null, p_after_line: at?.after_line ?? null,
      p_budget_ms: ROUND_MS,
    })
    if (error) throw error
    at = data as MatchRound
    matched += at.matched
    tried += at.tried
    onProgress?.({ matched, tried })
    if (at.tried === 0) break
    if (at.more && Date.now() - started > BUSY_MS) return { matched, tried, stopped: true }
  }
  return { matched, tried, stopped: false }
}
