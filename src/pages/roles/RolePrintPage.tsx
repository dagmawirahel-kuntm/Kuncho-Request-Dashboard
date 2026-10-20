import { Link, useParams } from 'react-router-dom'
import { useDepartments } from '@/hooks/useLookups'
import { useRoles, etbRange } from '@/lib/roles'
import { ArrowLeft, Printer } from 'lucide-react'

// A role as a job description to hand over or attach to a contract:
// headings in English and Amharic, the levels side by side, skills by level.

const H = ({ en, am }: { en: string; am: string }) => (
  <h2 className="mb-1.5 mt-5 border-b pb-1 text-sm font-bold uppercase tracking-wide text-slate-700 print:text-black">{en} <span className="font-semibold normal-case text-slate-500">/ {am}</span></h2>
)

export default function RolePrintPage() {
  const { id } = useParams<{ id: string }>()
  const { data: roles = [], isLoading } = useRoles(true)
  const { data: departments = [] } = useDepartments()
  const r = roles.find(x => x.id === id)
  if (isLoading) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  if (!r) return <p className="py-10 text-center text-sm text-slate-500">Role not found.</p>
  const dept = (departments as { id: string; name: string }[]).find(d => d.id === r.department_id)?.name
  const skills = r.items.filter(i => i.kind === 'skill')
  const duties = r.items.filter(i => i.kind === 'duty')
  const kpis = r.items.filter(i => i.kind === 'kpi')
  const anyBand = r.levels.some(l => etbRange(l.day_rate_min, l.day_rate_max) || etbRange(l.monthly_min, l.monthly_max))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/roles" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Roles</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"><Printer className="h-4 w-4" /> Print</button>
      </div>

      <article className="rounded-xl border bg-white p-8 text-slate-800 shadow-sm print:border-0 print:p-0 print:shadow-none dark:border-slate-700 dark:bg-white">
        <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Kuncho · Job description / የስራ መግለጫ</p>
            <h1 className="mt-1 text-2xl font-bold">{r.role_name}</h1>
            {r.role_name_am && <p className="text-lg text-slate-600">{r.role_name_am}</p>}
          </div>
          <div className="text-right text-xs text-slate-500">
            {r.confirmed_at ? <>Confirmed {new Date(r.confirmed_at).toLocaleDateString()}</> : <span className="font-semibold text-amber-700">DRAFT</span>}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">Department / ክፍል</dt><dd>{dept ?? '—'}</dd>
          <dt className="text-slate-500">Reports to / ተጠሪነት</dt><dd>{r.reports_to ?? '—'}</dd>
        </dl>

        {r.role_overview && (<><H en="Purpose" am="ዓላማ" /><p className="text-sm">{r.role_overview}</p></>)}

        <H en="Levels" am="ደረጃዎች" />
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2">Level / ደረጃ</th><th className="py-1 pr-2">Title</th><th className="py-1 pr-2">In a line</th>{anyBand && <th className="py-1">Pay band (ETB)</th>}</tr></thead>
          <tbody>
            {r.levels.map(l => (
              <tr key={l.level} className="border-t align-top">
                <td className="py-1.5 pr-2 font-semibold">{l.level} · ደረጃ {l.level}</td>
                <td className="py-1.5 pr-2">{l.title}{l.title_am && <><br /><span className="text-slate-500">{l.title_am}</span></>}</td>
                <td className="py-1.5 pr-2 text-slate-600">{l.summary ?? ''}</td>
                {anyBand && <td className="py-1.5 text-slate-600">{[etbRange(l.day_rate_min, l.day_rate_max) && `${etbRange(l.day_rate_min, l.day_rate_max)} / day`, etbRange(l.monthly_min, l.monthly_max) && `${etbRange(l.monthly_min, l.monthly_max)} / month`].filter(Boolean).join(' · ')}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {skills.length > 0 && (
          <>
            <H en="Skills" am="ክህሎቶች" />
            {r.levels.map(l => {
              const ls = skills.filter(s => s.level === l.level)
              if (!ls.length) return null
              return (
                <div key={l.level} className="mb-2">
                  <p className="text-xs font-semibold text-slate-500">Level {l.level} · ደረጃ {l.level} — {l.title}{l.level > 1 ? ' (adds to the level below)' : ''}</p>
                  <ul className="ml-4 list-disc text-sm">{ls.map(s => <li key={s.id}>{s.responsibility_title}{s.title_am && <span className="text-slate-500"> · {s.title_am}</span>}</li>)}</ul>
                </div>
              )
            })}
          </>
        )}

        {duties.length > 0 && (<><H en="Duties" am="ተግባራት" /><ul className="ml-4 list-disc text-sm">{duties.map(d => <li key={d.id}>{d.responsibility_title}</li>)}</ul></>)}
        {kpis.length > 0 && (<><H en="How the work is measured" am="መለኪያዎች" /><ul className="ml-4 list-disc text-sm">{kpis.map(k => <li key={k.id}>{k.responsibility_title}</li>)}</ul></>)}

        <div className="mt-10 grid grid-cols-2 gap-10 text-xs text-slate-500">
          <div className="border-t pt-1">Employee / ሰራተኛ — name, signature, date</div>
          <div className="border-t pt-1">Department head / የክፍል ኃላፊ — name, signature, date</div>
        </div>
      </article>
    </div>
  )
}
