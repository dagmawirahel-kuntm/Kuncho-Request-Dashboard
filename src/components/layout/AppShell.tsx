import { Outlet, useLocation, NavLink, Link } from 'react-router-dom'
import { useCompanyProfile } from '@/lib/companyProfile'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { PagePalette } from './PagePalette'
import { NAV_LAYOUTS, useNavData, useNavLayout, type NavLayout } from './navState'
import { GlobalSearch } from './GlobalSearch'
import { NotificationsBell } from './NotificationsBell'
import { AnimatedBackground } from '@/components/shared/AnimatedBackground'
import { SubmitStampHost } from '@/components/shared/SubmitStamp'
import { MyExpenseWatcher } from '@/components/shared/MyExpenseWatcher'
import { chime, confetti, useFunEffects, useFunSounds } from '@/lib/celebrate'
import { SeasonalGreeting } from '@/components/seasonal/SeasonalGreeting'
import { CelebrationsBar } from '@/components/celebrations/CelebrationsBar'
import { useSeason } from '@/hooks/useSeason'
import { LANDING_PATHS } from '@/router/landingPaths'
import { FiscalYearFilter } from '@/components/shared/FiscalYearFilter'
import { useAuth } from '@/contexts/AuthContext'
import { AtmosphereContext } from '@/components/clientWorld/atmosphereSlot'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import { LogOut, ChevronRight, Menu, Sun, Moon, Gem, CalendarRange, Settings, PanelLeft, PanelLeftDashed, PanelTop, Check, Sparkles } from 'lucide-react'

// Confetti, the submit stamp and the phone buzz, and (off unless chosen)
// soft sounds — lib/celebrate. Both saved per browser, like the theme.
function FunEffectsToggle() {
  const [on, setOn] = useFunEffects()
  const [sounds, setSounds] = useFunSounds()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // CSS-only touches (the streak flame, balloons) read this class.
  useEffect(() => { document.documentElement.classList.toggle('no-fun-effects', !on) }, [on])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const row = 'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60'
  const pill = (v: boolean) => `relative h-5 w-9 shrink-0 rounded-full transition-colors ${v ? 'bg-[#D4AF37]' : 'bg-slate-300 dark:bg-slate-600'}`
  const knob = (v: boolean) => `absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${v ? 'left-[18px]' : 'left-0.5'}`
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Fun effects and sounds"
        aria-haspopup="true"
        aria-expanded={open}
        className={`rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${on ? 'text-[#a57d1c] dark:text-[#D4AF37]' : 'text-slate-400 dark:text-slate-500'}`}
      >
        <Sparkles className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border bg-white p-1.5 shadow-lg animate-fade-in-up dark:border-slate-700 dark:bg-slate-800">
          <button type="button" role="switch" aria-checked={on} className={row}
            onClick={e => { const btn = e.currentTarget; setOn(!on); if (!on) confetti('pop', btn) }}>
            <span><span className="block font-medium">Fun effects</span><span className="block text-xs text-slate-400">Confetti, balloons, the submit stamp</span></span>
            <span className={pill(on)}><span className={knob(on)} /></span>
          </button>
          <button type="button" role="switch" aria-checked={sounds} className={row}
            onClick={() => { setSounds(!sounds); if (!sounds) window.setTimeout(() => chime('success'), 0) }}>
            <span><span className="block font-medium">Sounds</span><span className="block text-xs text-slate-400">A soft chime when things go through</span></span>
            <span className={pill(sounds)}><span className={knob(sounds)} /></span>
          </button>
        </div>
      )}
    </div>
  )
}

function FiscalYearControl() {
  const { periods, current, value, setValue, canToggle } = useFiscalYear()
  if (periods.length === 0) return null

  if (!canToggle) {
    return (
      <span
        title="Fiscal year (admin can change this for everyone)"
        className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400 sm:flex"
      >
        <CalendarRange className="h-3.5 w-3.5" />
        {current?.label ?? 'Current FY'}
      </span>
    )
  }

  return <FiscalYearFilter periods={periods} value={value} onChange={setValue} />
}

const LAYOUT_ICONS: Record<NavLayout, React.ElementType> = { sidebar: PanelLeft, rail: PanelLeftDashed, top: PanelTop }

// Where the navigation sits: sidebar, icon rail or top bar. Per person, on
// this browser; phones keep the drawer whichever is picked.
function NavLayoutPicker({ layout, onChange }: { layout: NavLayout; onChange: (next: NavLayout) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const Icon = LAYOUT_ICONS[layout]
  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        onClick={() => setOpen(o => !o)}
        title="Navigation layout"
        aria-expanded={open}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 z-50 mt-1 w-44 rounded-md border bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Navigation</p>
          {NAV_LAYOUTS.map(({ value, label }) => {
            const ItemIcon = LAYOUT_ICONS[value]
            return (
              <button
                key={value}
                onClick={() => { onChange(value); setOpen(false) }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <ItemIcon className="h-4 w-4 text-slate-400" />
                <span className="flex-1 text-left">{label}</span>
                {layout === value && <Check className="h-3.5 w-3.5 text-slate-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const breadcrumbLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  overview: 'Company Overview',
  requests: 'Requests',
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  management: 'Management',
  expenses: 'Expenses',
  orders: 'Orders',
  transportation: 'Transportation',
  'purchase-allocation': 'Purchase Allocation',
  vendors: 'Vendors',
  'general-ledger': 'General Ledger',
  'sub-ledgers': 'Sub Ledgers',
  'vendor-receipts': 'Vendor Receipts',
  'vendor-credits': 'Vendor Credits',
  'payment-requests': 'Payment Requests',
  accounts: 'Accounts',
  sales: 'Sales',
  'tax-summary': 'Tax Summary',
  'batch-payments': 'Batch Payments',
  'cpo-bonds': 'CPO Bonds',
  staff: 'Staff',
  payroll: 'Payroll',
  'payroll-taxes': 'Payroll Taxes',
  'emergency-payroll': 'Emergency Payroll',
  'cash-advances': 'Cash Advances',
  timesheet: 'Timesheet',
  projects: 'Projects',
  products: 'Products',
  locations: 'Locations',
}

const roleBadgeColors: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  finance: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  staff: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  procurement_officer: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  hr_officer: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  project_manager: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

export type Theme = 'light' | 'dark' | 'gold'
const THEME_ORDER: Theme[] = ['light', 'dark', 'gold']

export function AppShell() {
  const { profile, role, signOut } = useAuth()
  // The company's identity for every printed document (migration 368).
  useCompanyProfile()
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  const nav = useNavData()
  const [layout, setLayout] = useNavLayout()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    // Migrates the old binary 'dark'/'light' values transparently — anyone
    // who had 'dark' saved keeps seeing Dark, not Gold, after this ships.
    return saved === 'dark' || saved === 'gold' ? saved : 'light'
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const root = document.documentElement
    // Gold is layered on top of Dark (shares all dark: utility styling,
    // adds its own warm near-black overrides) — so both classes apply.
    root.classList.toggle('dark', theme === 'dark' || theme === 'gold')
    root.classList.toggle('gold', theme === 'gold')
    localStorage.setItem('theme', theme)
  }, [theme])

  // Holidays (lib/seasons.ts) dress the shell on their own schedule; the
  // `meskel` class on <html> carries the accent colour changes in index.css.
  const season = useSeason()
  const festive = !!season?.festive
  useEffect(() => {
    document.documentElement.classList.toggle('meskel', festive)
  }, [festive])

  // The layer client pages paint their world into (components/clientWorld).
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const slot = useMemo(() => ({ layer, scroller }), [layer, scroller])

  function cycleTheme() {
    const root = document.documentElement
    root.classList.add('theme-transition')
    setTheme(t => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length])
    setTimeout(() => root.classList.remove('theme-transition'), 350)
  }

  return (
    <>
    <AnimatedBackground />
    <div className="relative z-10 flex h-screen overflow-hidden bg-transparent print:block print:h-auto print:overflow-visible">
      <Sidebar
        nav={nav}
        layout={layout}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        theme={theme}
        onToggleTheme={cycleTheme}
        festive={festive}
      />
      <div className="relative flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        {layout === 'top' && <TopNav nav={nav} theme={theme} festive={festive} onToggleTheme={cycleTheme} />}
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4 sm:px-6 dark:bg-slate-800 dark:border-slate-700 print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 lg:hidden dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb */}
          <nav className="hidden items-center gap-1 text-sm text-slate-500 md:flex dark:text-slate-400">
            <NavLink to="/home" className="hover:text-slate-700 dark:hover:text-slate-200">Home</NavLink>
            {segments.map((seg, i) => (
              <span key={seg} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <span className={i === segments.length - 1 ? 'font-medium text-slate-800 dark:text-slate-100' : ''}>
                  {breadcrumbLabels[seg] ?? seg}
                </span>
              </span>
            ))}
          </nav>

          <div className="flex flex-1 justify-center px-2 sm:px-4">
            <GlobalSearch />
          </div>

          {/* User info */}
          <div className="flex items-center gap-2 sm:gap-3">
            <FiscalYearControl />
            <NavLayoutPicker layout={layout} onChange={setLayout} />
            <button
              onClick={cycleTheme}
              title={theme === 'light' ? 'Switch to dark mode' : theme === 'dark' ? 'Switch to gold theme' : 'Switch to light mode'}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : theme === 'dark' ? <Gem className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <FunEffectsToggle />
            <NotificationsBell />
            {role && (
              <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize sm:inline ${roleBadgeColors[role] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {role.replace(/_/g, ' ')}
              </span>
            )}
            <span className="hidden text-sm font-medium text-slate-700 md:inline dark:text-slate-200">{profile?.full_name ?? 'User'}</span>
            <Link
              to="/settings"
              title="Settings"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <div ref={setLayer} className={`pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden print:hidden ${layout === 'top' ? 'top-14 lg:top-28' : 'top-14'}`} aria-hidden />

        {/* Main content */}
        <main ref={setScroller} className="relative flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">
          {season?.greeting && LANDING_PATHS.has(location.pathname) && (
            <div className="print:hidden"><SeasonalGreeting moment={season} /></div>
          )}
          {LANDING_PATHS.has(location.pathname) && <CelebrationsBar skipHoliday={!!season?.greeting} />}
          <div key={location.pathname} className="animate-fade-in">
            <AtmosphereContext.Provider value={slot}>
              <Outlet />
            </AtmosphereContext.Provider>
          </div>
        </main>
      </div>
    </div>
    <PagePalette nav={nav} />
    <SubmitStampHost />
    <MyExpenseWatcher />
    </>
  )
}
