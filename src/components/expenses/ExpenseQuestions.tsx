import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircleQuestion } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { canApproveAsFinance } from '@/lib/expenseAccess'
import { useExpenseQuestions } from '@/lib/approvals'
import { formatDateTime } from '@/lib/utils'

// Questions finance asked about an expense before approving it (migration
// 444). Whoever raised it answers here; the answer goes back to the
// approval queue and to whoever asked.
export function ExpenseQuestions({ expense }: {
  expense: { id: string; approval_status: string; purchaser_user_id: string | null }
}) {
  const { role, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: questions = [] } = useExpenseQuestions(expense.id)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // Finance records an answer given another way (a call, in person) only on request.
  const [onBehalf, setOnBehalf] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)

  const me = user?.id ?? null
  const finance = canApproveAsFinance(role)
  const raisedIt = !!me && expense.purchaser_user_id === me
  const waiting = ['pending', 'manager_approved'].includes(expense.approval_status)
  const open = questions.filter(q => !q.answered_at)
  const canAsk = finance && waiting && !!expense.purchaser_user_id && !raisedIt && open.length === 0

  function refresh() {
    qc.invalidateQueries({ queryKey: ['expense-questions', expense.id] })
    qc.invalidateQueries({ queryKey: ['approval-context'] })
  }

  async function answer(id: string) {
    const text = drafts[id]?.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.rpc('answer_expense_question', { p_question_id: id, p_answer: text })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Answered — it goes back to whoever asked', 'success')
    setDrafts(d => ({ ...d, [id]: '' }))
    setOnBehalf(null)
    refresh()
  }

  async function ask() {
    const text = question.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.rpc('ask_expense_question', { p_expense_id: expense.id, p_question: text })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Asked — whoever raised it is notified, and the answer comes back to the approval queue', 'success')
    setQuestion('')
    setAsking(false)
    refresh()
  }

  if (questions.length === 0 && !canAsk) return null

  if (questions.length === 0) {
    return asking ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-900/20">
        <MessageCircleQuestion className="h-4 w-4 shrink-0 text-sky-600" />
        <input autoFocus value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && question.trim()) { e.preventDefault(); void ask() } }}
          placeholder="What do you need to know before approving it?"
          className="min-w-[200px] flex-1 rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button disabled={busy || !question.trim()} onClick={ask}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Ask</button>
        <button onClick={() => { setAsking(false); setQuestion('') }} className="rounded-md border px-3 py-1.5 text-xs dark:border-slate-600">Cancel</button>
      </div>
    ) : (
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        Not sure about it? Ask whoever raised it, instead of rejecting.
        <button onClick={() => setAsking(true)}
          className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2.5 py-1 font-medium text-sky-700 hover:bg-sky-100 dark:bg-sky-900/20 dark:text-sky-300">
          <MessageCircleQuestion className="h-3.5 w-3.5" /> Ask a question
        </button>
      </p>
    )
  }

  const needsMe = waiting && raisedIt && open.length > 0
  return (
    <section className={`rounded-xl border px-4 py-3 ${needsMe
      ? 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-100'
      : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageCircleQuestion className="h-4 w-4 text-sky-600" />
        {needsMe ? 'Finance has a question before approving this' : open.length && waiting ? 'Waiting for an answer' : 'Questions about this expense'}
      </p>
      <ol className="mt-2 space-y-3">
        {questions.map(q => {
          const mayAnswer = !q.answered_at && waiting && (raisedIt || finance)
          const showBox = mayAnswer && (raisedIt || onBehalf === q.id)
          return (
            <li key={q.id} className="text-sm">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{q.asked_by_name ?? 'Finance'}</span> asked · {formatDateTime(q.asked_at)}
              </p>
              <p className="whitespace-pre-wrap">{q.question}</p>
              {q.answered_at ? (
                <div className="mt-1.5 border-l-2 border-violet-300 pl-2.5 dark:border-violet-700">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{q.answered_by_name ?? 'Answered'}</span> answered · {formatDateTime(q.answered_at)}
                  </p>
                  <p className="whitespace-pre-wrap">{q.answer}</p>
                </div>
              ) : showBox ? (
                <div className="mt-1.5 space-y-1.5">
                  <textarea rows={2} autoFocus={!raisedIt} value={drafts[q.id] ?? ''}
                    onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                    placeholder={raisedIt ? `Your answer — it goes back to ${q.asked_by_name ?? 'finance'}` : 'Their answer, as they gave it to you'}
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  <div className="flex gap-2">
                    <button disabled={busy || !drafts[q.id]?.trim()} onClick={() => answer(q.id)}
                      className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                      {raisedIt ? 'Send answer' : 'Record their answer'}
                    </button>
                    {!raisedIt && <button onClick={() => setOnBehalf(null)} className="rounded-md border px-3 py-1.5 text-xs dark:border-slate-600">Cancel</button>}
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {!waiting ? 'Not answered — the expense has been decided.' : 'Waiting for whoever raised it to answer.'}
                  {mayAnswer && (
                    <button onClick={() => setOnBehalf(q.id)} className="ml-2 font-medium text-sky-700 hover:underline dark:text-sky-300">
                      They told you? Record their answer
                    </button>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ol>
      {canAsk && !asking && (
        <button onClick={() => setAsking(true)} className="mt-3 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300">Ask another question</button>
      )}
      {canAsk && asking && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input autoFocus value={question} onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && question.trim()) { e.preventDefault(); void ask() } }}
            placeholder="What else do you need to know?"
            className="min-w-[200px] flex-1 rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <button disabled={busy || !question.trim()} onClick={ask}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Ask</button>
          <button onClick={() => { setAsking(false); setQuestion('') }} className="rounded-md border px-3 py-1.5 text-xs dark:border-slate-600">Cancel</button>
        </div>
      )}
    </section>
  )
}
