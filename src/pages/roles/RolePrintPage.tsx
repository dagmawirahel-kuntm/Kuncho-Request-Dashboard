import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDepartments } from '@/hooks/useLookups'
import { useRoles, useStaffRoles, useRoleLang, langLabel, etbRange, type RoleLang, type RoleLevel, type RoleWithParts } from '@/lib/roles'
import { Bi, LangToggle } from './RoleLang'
import { ArrowLeft, Printer } from 'lucide-react'

// A role as a job description to hand over or attach to a contract.
//
// One level at a time: the person's own level when it is printed for them
// (?staff=), else the level picked (?level=, level 1 by default) — with the
// skills up to that level, the duties and the measures. "All levels" is the
// whole ladder on one sheet, for HR. In English, Amharic or both (?lang=).

const H = ({ lang, en, am }: { lang: RoleLang; en: string; am: string }) => (
  <h2 className="mb-1.5 mt-5 border-b pb-1 text-sm font-bold uppercase tracking-wide text-slate-700 print:text-black">
    {lang === 'both' ? <>{en} <span className="font-semibold normal-case text-slate-500">/ {am}</span></> : lang === 'am' ? am : en}
  </h2>
)

const band = (l: RoleLevel, lang: RoleLang) => [
  etbRange(l.day_rate_min, l.day_rate_max) && `${etbRange(l.day_rate_min, l.day_rate_max)} ${langLabel(lang, 'a day', 'በቀን')}`,
  etbRange(l.monthly_min, l.monthly_max) && `${etbRange(l.monthly_min, l.monthly_max)} ${langLabel(lang, 'a month', 'በወር')}`,
].filter(Boolean).join(' · ')

export default function RolePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const { data: roles = [], isLoading } = useRoles(true)
  const { data: departments = [] } = useDepartments()
  const { data: people = [] } = useStaffRoles()
  const [lang, setLang] = useRoleLang(params.get('lang'))
  const r = roles.find(x => x.id === id)
  if (isLoading) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  if (!r) return <p className="py-10 text-center text-sm text-slate-500">Role not found.</p>

  const person = people.find(p => p.staff_id === params.get('staff') && p.job_description_id === r.id) ?? null
  const asked = params.get('level')
  const level: number | 'all' = asked === 'all' ? 'all'
    : Number(asked) >= 1 && r.levels.some(l => l.level === Number(asked)) ? Number(asked)
    : person?.role_level ?? r.levels[0]?.level ?? 1
  const pick = (next: number | 'all') => setParams(p => { const n = new URLSearchParams(p); n.set('level', String(next)); return n }, { replace: true })
  const changeLang = (l: RoleLang) => { setLang(l); setParams(p => { const n = new URLSearchParams(p); n.set('lang', l); return n }, { replace: true }) }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link to={person ? `/staff/${person.staff_id}/skills` : '/roles'} className="mr-auto inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand">
          <ArrowLeft className="h-4 w-4" /> {person ? person.employee_name : 'Roles'}
        </Link>
        {r.levels.length > 1 && (
          <div role="group" aria-label="Level" className="inline-flex rounded-md border p-0.5 text-xs dark:border-slate-600">
            {[...r.levels.map(l => l.level), 'all' as const].map(n => (
              <button key={n} type="button" aria-pressed={level === n} onClick={() => pick(n)}
                className={`rounded px-2.5 py-1 font-medium ${level === n ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                {n === 'all' ? 'All levels' : `Level ${n}`}
              </button>
            ))}
          </div>
        )}
        <LangToggle lang={lang} onChange={changeLang} />
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"><Printer className="h-4 w-4" /> Print</button>
      </div>

      {level === 'all'
        ? <AllLevels r={r} lang={lang} dept={(departments as { id: string; name: string }[]).find(d => d.id === r.department_id)?.name} />
        : <OneLevel r={r} n={level} lang={lang} dept={(departments as { id: string; name: string }[]).find(d => d.id === r.department_id)?.name} personName={person?.employee_name ?? null} />}
    </div>
  )
}

function Head({ r, lang, sub }: { r: RoleWithParts; lang: RoleLang; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Kuncho · {langLabel(lang, 'Job description', 'የስራ መግለጫ')}</p>
        <h1 className="mt-1 text-2xl font-bold">{lang === 'am' ? (r.role_name_am || r.role_name) : r.role_name}</h1>
        {lang === 'both' && r.role_name_am && <p className="text-lg text-slate-600">{r.role_name_am}</p>}
        {sub}
      </div>
      <div className="text-right text-xs text-slate-500">
        {r.confirmed_at
          ? <>{langLabel(lang, 'Confirmed', 'የጸደቀ')} {new Date(r.confirmed_at).toLocaleDateString()}</>
          : <span className="font-semibold text-amber-700">{langLabel(lang, 'DRAFT', 'ረቂቅ')}</span>}
      </div>
    </div>
  )
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

function Signatures({ lang, personName }: { lang: RoleLang; personName?: string | null }) {
  const sign = langLabel(lang, 'name, signature, date', 'ስም፣ ፊርማ፣ ቀን')
  return (
    <div className="mt-10 grid grid-cols-2 gap-10 text-xs text-slate-500">
      <div className="border-t pt-1">{langLabel(lang, 'Employee', 'ሰራተኛ')}{personName ? `: ${personName}` : ''} — {sign}</div>
      <div className="border-t pt-1">{langLabel(lang, 'Department head', 'የክፍል ኃላፊ')} — {sign}</div>
    </div>
  )
}

const Items = ({ items, lang }: { items: RoleWithParts['items']; lang: RoleLang }) => (
  <ul className="ml-4 list-disc space-y-0.5 text-sm">
    {items.map(i => (
      <li key={i.id}>
        <Bi lang={lang} en={i.responsibility_title} am={i.title_am} />
        {(i.responsibility_detail || i.detail_am) && <span className="block text-xs text-slate-500"><Bi lang={lang} en={i.responsibility_detail} am={i.detail_am} /></span>}
      </li>
    ))}
  </ul>
)

/** The job at one level: what that level does, every skill it needs (its
 *  own and the ones below it), the duties and how the work is measured. */
function OneLevel({ r, n, lang, dept, personName }: { r: RoleWithParts; n: number; lang: RoleLang; dept?: string; personName: string | null }) {
  const l = r.levels.find(x => x.level === n)
  const skills = r.items.filter(i => i.kind === 'skill' && i.level <= n)
  const duties = r.items.filter(i => i.kind === 'duty' && i.level <= n)
  const kpis = r.items.filter(i => i.kind === 'kpi' && i.level <= n)
  const byLevel = r.levels.filter(x => x.level <= n).map(x => ({ x, list: skills.filter(s => s.level === x.level) })).filter(g => g.list.length)
  const pay = l ? band(l, lang) : ''

  return (
    <article className="rounded-xl border bg-white p-8 text-slate-800 shadow-sm print:border-0 print:p-0 print:shadow-none dark:border-slate-700 dark:bg-white">
      <Head r={r} lang={lang} sub={r.levels.length > 1 && l && (
        <p className="mt-1 text-sm font-semibold text-slate-700">
          {langLabel(lang, `Level ${n}`, `ደረጃ ${n}`)} — <Bi lang={lang} en={l.title} am={l.title_am} amClass="font-normal text-slate-500" inline />
        </p>
      )} />

      <Facts rows={[
        ...(personName ? [[langLabel(lang, 'Employee', 'ሰራተኛ'), personName] as [string, React.ReactNode]] : []),
        [langLabel(lang, 'Department', 'ክፍል'), dept ?? '—'],
        [langLabel(lang, 'Reports to', 'ተጠሪነት'), r.reports_to ? <Bi lang={lang} en={r.reports_to} am={r.reports_to_am} amClass="text-slate-500" inline /> : '—'],
        ...(pay ? [[langLabel(lang, 'Pay band (ETB)', 'የክፍያ ወሰን (ብር)'), pay] as [string, React.ReactNode]] : []),
      ]} />

      {r.role_overview && (<><H lang={lang} en="Purpose" am="ዓላማ" /><p className="text-sm"><Bi lang={lang} en={r.role_overview} am={r.role_overview_am} /></p></>)}

      {r.levels.length > 1 && l?.summary && (
        <><H lang={lang} en="At this level" am="በዚህ ደረጃ" /><p className="text-sm"><Bi lang={lang} en={l.summary} am={l.summary_am} /></p></>
      )}

      {skills.length > 0 && (
        <>
          <H lang={lang} en="Skills" am="ክህሎቶች" />
          {byLevel.length === 1
            ? <Items items={byLevel[0].list} lang={lang} />
            : byLevel.map(({ x, list }) => (
              <div key={x.level} className="mb-2">
                <p className="text-xs font-semibold text-slate-500">
                  {x.level === n ? langLabel(lang, `Added at level ${n}`, `በደረጃ ${n} የሚጨመሩ`) : langLabel(lang, `From level ${x.level}`, `ከደረጃ ${x.level}`)}
                </p>
                <Items items={list} lang={lang} />
              </div>
            ))}
        </>
      )}

      {duties.length > 0 && (<><H lang={lang} en="Duties" am="ተግባራት" /><Items items={duties} lang={lang} /></>)}
      {kpis.length > 0 && (<><H lang={lang} en="How the work is measured" am="መለኪያዎች" /><Items items={kpis} lang={lang} /></>)}

      <Signatures lang={lang} personName={personName} />
    </article>
  )
}

/** The whole ladder on one sheet: every level's title and band, and the skills each adds. */
function AllLevels({ r, lang, dept }: { r: RoleWithParts; lang: RoleLang; dept?: string }) {
  const skills = r.items.filter(i => i.kind === 'skill')
  const duties = r.items.filter(i => i.kind === 'duty')
  const kpis = r.items.filter(i => i.kind === 'kpi')
  const anyBand = r.levels.some(l => band(l, lang))

  return (
    <article className="rounded-xl border bg-white p-8 text-slate-800 shadow-sm print:border-0 print:p-0 print:shadow-none dark:border-slate-700 dark:bg-white">
      <Head r={r} lang={lang} sub={<p className="mt-1 text-sm text-slate-500">{langLabel(lang, 'All levels', 'ሁሉም ደረጃዎች')}</p>} />
      <Facts rows={[
        [langLabel(lang, 'Department', 'ክፍል'), dept ?? '—'],
        [langLabel(lang, 'Reports to', 'ተጠሪነት'), r.reports_to ? <Bi lang={lang} en={r.reports_to} am={r.reports_to_am} amClass="text-slate-500" inline /> : '—'],
      ]} />

      {r.role_overview && (<><H lang={lang} en="Purpose" am="ዓላማ" /><p className="text-sm"><Bi lang={lang} en={r.role_overview} am={r.role_overview_am} /></p></>)}

      <H lang={lang} en="Levels" am="ደረጃዎች" />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 pr-2">{langLabel(lang, 'Level', 'ደረጃ')}</th>
            <th className="py-1 pr-2">{langLabel(lang, 'Title', 'መጠሪያ')}</th>
            <th className="py-1 pr-2">{langLabel(lang, 'In a line', 'በአጭሩ')}</th>
            {anyBand && <th className="py-1">{langLabel(lang, 'Pay band (ETB)', 'የክፍያ ወሰን (ብር)')}</th>}
          </tr>
        </thead>
        <tbody>
          {r.levels.map(l => (
            <tr key={l.level} className="border-t align-top">
              <td className="py-1.5 pr-2 font-semibold">{langLabel(lang, `${l.level}`, `ደረጃ ${l.level}`)}</td>
              <td className="py-1.5 pr-2"><Bi lang={lang} en={l.title} am={l.title_am} /></td>
              <td className="py-1.5 pr-2 text-slate-600"><Bi lang={lang} en={l.summary} am={l.summary_am} /></td>
              {anyBand && <td className="py-1.5 text-slate-600">{band(l, lang)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {skills.length > 0 && (
        <>
          <H lang={lang} en="Skills" am="ክህሎቶች" />
          {r.levels.map(l => {
            const ls = skills.filter(s => s.level === l.level)
            if (!ls.length) return null
            return (
              <div key={l.level} className="mb-2">
                <p className="text-xs font-semibold text-slate-500">
                  {langLabel(lang, `Level ${l.level}`, `ደረጃ ${l.level}`)} — {lang === 'am' ? (l.title_am || l.title) : l.title}
                  {l.level > 1 ? langLabel(lang, ' (adds to the level below)', ' (ከታችኛው ደረጃ በተጨማሪ)') : ''}
                </p>
                <Items items={ls} lang={lang} />
              </div>
            )
          })}
        </>
      )}

      {duties.length > 0 && (<><H lang={lang} en="Duties" am="ተግባራት" /><Items items={duties} lang={lang} /></>)}
      {kpis.length > 0 && (<><H lang={lang} en="How the work is measured" am="መለኪያዎች" /><Items items={kpis} lang={lang} /></>)}

      <Signatures lang={lang} />
    </article>
  )
}
