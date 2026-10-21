import { ROLE_LANGS, type RoleLang } from '@/lib/roles'

/** Words in the chosen language; with both, the Amharic follows on its own
 *  line — or after a dot on the same line when `inline`. */
export function Bi({ lang, en, am, amClass = 'block text-slate-500', inline = false }: {
  lang: RoleLang
  en: string | null | undefined
  am: string | null | undefined
  amClass?: string
  inline?: boolean
}) {
  if (lang === 'en') return <>{en ?? ''}</>
  if (lang === 'am') return <>{am || en || ''}</>
  return <>{en ?? ''}{am && <span className={amClass}>{inline ? ` · ${am}` : am}</span>}</>
}

/** English, Amharic or both — for the role pages and the job description. */
export function LangToggle({ lang, onChange }: { lang: RoleLang; onChange: (l: RoleLang) => void }) {
  return (
    <div role="group" aria-label="Language" className="inline-flex rounded-md border p-0.5 text-xs dark:border-slate-600">
      {ROLE_LANGS.map(([l, label]) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => onChange(l)}
          className={`rounded px-2.5 py-1 font-medium ${lang === l ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{label}</button>
      ))}
    </div>
  )
}
