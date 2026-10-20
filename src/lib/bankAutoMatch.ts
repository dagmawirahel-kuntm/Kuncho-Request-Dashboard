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

/**
 * Match bank lines automatically, a round at a time. Each round stops after
 * ~4 s so it stays under the database's request limit; this keeps calling
 * the next one from where the last stopped until every line has been tried.
 * Pass the round the import already ran to carry on from it.
 */
export async function autoMatchBankLines({ importId = null, accountId = null, from, onProgress }: {
  importId?: string | null
  accountId?: string | null
  from?: MatchRound | null
  onProgress?: (p: { matched: number; tried: number }) => void
}): Promise<{ matched: number; tried: number }> {
  let matched = from?.matched ?? 0
  let tried = from?.tried ?? 0
  let at: MatchRound | null = from ?? null
  for (let i = 0; i < 500 && (at === null || at.more); i++) {
    const { data, error } = await supabase.rpc('auto_reconcile_bank_lines_round', {
      p_import_id: importId, p_account_id: accountId,
      p_after_date: at?.after_date ?? null, p_after_no: at?.after_no ?? null, p_after_line: at?.after_line ?? null,
    })
    if (error) throw error
    at = data as MatchRound
    matched += at.matched
    tried += at.tried
    onProgress?.({ matched, tried })
    if (at.tried === 0) break
  }
  return { matched, tried }
}
