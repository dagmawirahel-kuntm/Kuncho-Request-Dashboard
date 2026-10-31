import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency as fmtMoney, formatDate } from '@/lib/utils'
import { Panel, Pill, Stat } from '@/components/record/Record'
import { printHtml } from '@/lib/documents/issue'
import { useCompanyProfile } from '@/lib/companyProfile'
import { buildContractStatementHtml } from '@/lib/documents/variationDocument'
import { useContractSum, useVariations, VO_STATUS, VO_MANAGE_ROLES, BASE_SOURCE_LABEL, OPEN_STATUSES } from '@/lib/variations'
import { GitPullRequestArrow, Plus, Printer } from 'lucide-react'
import { EmailDocumentButton } from '@/components/documents/EmailDocumentDialog'

const formatCurrency = (n: number) => fmtMoney(n).replace(/\.00$/, '')

// A project's variations (migration 459): the original agreement, every
// agreed VO added as an addendum, the revised contract sum, and what is
// still being priced or waiting on the client.
export function ProjectVariationsPanel({ projectId, projectName, clientId }: { projectId: string; projectName: string; clientId: string | null }) {
  const { hasRole } = useAuth()
  const canManage = hasRole(...VO_MANAGE_ROLES)
  const { data: sum } = useContractSum(projectId)
  const { data: vos = [], isLoading } = useVariations(projectId)
  useCompanyProfile()
  const { data: client } = useQuery({
    queryKey: ['client-name', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('client_name, email').eq('id', clientId!).maybeSingle()
      return (data as { client_name: string; email: string | null } | null) ?? null
    },
  })

  const agreed = vos.filter(v => v.status === 'agreed').sort((a, b) => a.vo_number - b.vo_number)
  const open = vos.filter(v => OPEN_STATUSES.includes(v.status))
  const agreementRef = sum?.base_source === 'contract' || sum?.base_source === 'proforma' ? sum.base_ref : null

  const statement = () => buildContractStatementHtml({
    projectName, client: client ?? null, agreementRef, original: sum?.base_value ?? null, date: new Date().toISOString().slice(0, 10),
    variations: agreed.map(v => ({ code: v.vo_code, title: v.title, agreedOn: v.agreed_on, total: v.total, days: v.time_extension_days })),
    pending: open.filter(v => v.amount !== 0).map(v => ({ code: v.vo_code, title: v.title, status: VO_STATUS[v.status].label, total: v.total })),
  })
  const printStatement = () => printHtml(statement(), `Contract statement ${projectName}`)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Original agreement" value={sum?.base_value != null ? formatCurrency(sum.base_value) : '—'} sub={sum?.base_source ? `${BASE_SOURCE_LABEL[sum.base_source]}${sum.base_ref && sum.base_source !== 'project' ? ` · ${sum.base_ref}` : ''}` : 'no contract value on record'} tone={sum?.base_value == null ? 'amber' : undefined} />
        <Stat label="Agreed variations" value={formatCurrency(sum?.agreed_total ?? 0)} sub={`${sum?.agreed_count ?? 0} ${(sum?.agreed_count ?? 0) === 1 ? 'addendum' : 'addenda'}${sum?.agreed_days ? ` · +${sum.agreed_days} days` : ''}`} />
        <Stat label="Revised contract sum" value={formatCurrency(sum?.revised_sum ?? 0)} tone="green" />
        <Stat label="Not yet agreed" value={formatCurrency(sum?.pending_total ?? 0)} sub={`${(sum?.pending_count ?? 0) + (sum?.to_price_count ?? 0)} open${sum?.to_price_count ? ` · ${sum.to_price_count} to price` : ''}`} tone={(sum?.pending_count ?? 0) + (sum?.to_price_count ?? 0) > 0 ? 'amber' : undefined} />
      </div>

      <Panel title="Variations" icon={GitPullRequestArrow} count={vos.length || null} padded={false}
        action={<div className="flex items-center gap-3">
          {(agreed.length > 0 || open.length > 0) && <EmailDocumentButton kind="contract_statement" sourceId={projectId} title={`contract statement for ${projectName}`}
            fileName={`Contract statement ${projectName}`} party={client?.client_name} defaultTo={client?.email} prepare={() => ({ html: statement() })}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-brand dark:text-slate-300 [&>svg]:h-3.5 [&>svg]:w-3.5" />}
          {(agreed.length > 0 || open.length > 0) && <button onClick={printStatement} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-brand dark:text-slate-300"><Printer className="h-3.5 w-3.5" /> Contract statement</button>}
          {canManage && <Link to={`/variations/new?project=${projectId}`} className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" /> Add variation</Link>}
        </div>}>
        {isLoading ? <p className="px-4 py-4 text-sm text-slate-400">Loading…</p> : vos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No variations. When the client, a consultant or an executive asks for a change — or a foreman flags one on the daily report — record it here the same day, even before it has a price.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700/60">
            {vos.map(v => (
              <li key={v.id}>
                <Link to={`/variations/${v.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <span className="w-12 shrink-0 font-mono text-xs font-semibold text-brand">{v.vo_code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{v.title}</span>
                    <span className="text-[11px] text-slate-400">asked {formatDate(v.instructed_on)}{v.agreed_on ? ` · agreed ${formatDate(v.agreed_on)}` : ''}</span>
                  </span>
                  <Pill tone={VO_STATUS[v.status].tone}>{VO_STATUS[v.status].label}</Pill>
                  <span className={`w-28 text-right text-sm font-semibold tabular-nums ${v.amount === 0 ? 'text-slate-400' : ''}`}>{v.amount === 0 ? 'not priced' : formatCurrency(v.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
