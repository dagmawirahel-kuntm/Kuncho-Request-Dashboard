// The sales hub (migration 539): one place for everything about selling —
// what's waiting on whom, every deal on the board, everything that happened
// with every client, the numbers, and the buttons to record more.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FilePlus, Handshake, MessagesSquare, UserPlus, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { ClientPickerDialog } from '@/components/shared/ClientPickerDialog'
import { useHubClients, useHubDeals, useHubFeed, useHubFollowups } from '@/lib/salesHub'
import { FeedPanel, FindAnything, FollowupsPanel, KpiStrip, NewClientDialog, Panel, PipelineBoard, QuickLog, Scorecard } from './HubParts'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'

export default function SalesHubPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const { data: deals = [] } = useHubDeals()
  const { data: followups = [] } = useHubFollowups()
  const { data: feed = [] } = useHubFeed()
  const { data: clients = [] } = useHubClients()
  // Sales starts on their own work; leadership starts on everyone's.
  const [mine, setMine] = useState(role === 'sales')
  const [dialog, setDialog] = useState<null | 'client' | 'pick-log' | 'pick-proforma'>(null)
  const [logFor, setLogFor] = useState<string | null>(null)

  const myCount = followups.filter(f => f.owner_user_id === user?.id).length
  const scope = (
    <div className="inline-flex overflow-hidden rounded-md border text-xs dark:border-slate-600">
      {[{ v: true, l: `Mine (${myCount})` }, { v: false, l: `Everyone (${followups.length})` }].map(o => (
        <button key={String(o.v)} type="button" onClick={() => setMine(o.v)}
          className={`px-2.5 py-1 ${mine === o.v ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-300'}`}>{o.l}</button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Sales Hub</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every client, deal, quote, conversation and payment, in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/opportunities/new" className={btn}><Handshake className="h-4 w-4" /> New deal</Link>
          <button type="button" onClick={() => setDialog('client')} className={btn}><UserPlus className="h-4 w-4" /> New client</button>
          <button type="button" onClick={() => setDialog('pick-log')} className={btn}><MessagesSquare className="h-4 w-4" /> Log a conversation</button>
          <button type="button" onClick={() => setDialog('pick-proforma')} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            <FilePlus className="h-4 w-4" /> New proforma
          </button>
        </div>
      </div>

      <FindAnything deals={deals} clients={clients} />
      <KpiStrip deals={deals} clients={clients} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel title="Needs attention" right={scope}>
            <FollowupsPanel items={followups} mine={mine} userId={user?.id} />
          </Panel>
          <Panel title="Pipeline" right={<Link to="/opportunities" className="text-xs text-slate-400 hover:text-brand">All deals →</Link>}>
            <PipelineBoard deals={deals} mine={mine} userId={user?.id} />
          </Panel>
        </div>
        <Panel title="Everything that happened" right={<Link to="/sales-journey" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand"><Users className="h-3.5 w-3.5" /> By client →</Link>}>
          <FeedPanel events={feed} />
        </Panel>
      </div>

      <Scorecard />

      {dialog === 'client' && <NewClientDialog onClose={() => setDialog(null)} />}
      {dialog === 'pick-log' && (
        <ClientPickerDialog title="Log a conversation with…" onClose={() => setDialog(null)}
          onPick={cid => { setDialog(null); setLogFor(cid) }} />
      )}
      {dialog === 'pick-proforma' && (
        <ClientPickerDialog title="New proforma for…" onClose={() => setDialog(null)}
          onPick={cid => { setDialog(null); navigate(`/clients/${cid}/proforma`) }} />
      )}
      {logFor && <QuickLog clientId={logFor} userId={user?.id} onClose={() => setLogFor(null)} />}
    </div>
  )
}
