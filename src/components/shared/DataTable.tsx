import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search, Columns3, Download, BookmarkPlus, Bookmark, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SavedView {
  name: string
  globalFilter: string
  sorting: SortingState
  columnVisibility: VisibilityState
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  searchPlaceholder?: string
  /** Unique key used to persist column visibility & saved views in localStorage. Pass a stable string per table (e.g. "expenses"). */
  persistKey?: string
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onOutside])
  return ref
}

function ColumnVisibilityMenu<TData>({ table }: { table: ReturnType<typeof useReactTable<TData>> }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        <Columns3 className="h-4 w-4" /> Columns
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-y-auto rounded-md border bg-white p-2 shadow-lg">
          {table.getAllLeafColumns().filter(c => c.id !== 'actions').map(column => (
            <label key={column.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
              />
              <span className="truncate">
                {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
}: {
  views: SavedView[]
  onApply: (v: SavedView) => void
  onSave: (name: string) => void
  onDelete: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ref = useClickOutside(() => { setOpen(false); setNaming(false) })

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        <Bookmark className="h-4 w-4" /> Views
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-white p-2 shadow-lg">
          {views.length === 0 && !naming && <p className="px-2 py-3 text-center text-xs text-slate-400">No saved views yet</p>}
          {views.map(v => (
            <div key={v.name} className="group flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <button className="flex-1 truncate text-left" onClick={() => { onApply(v); setOpen(false) }}>{v.name}</button>
              <button onClick={() => onDelete(v.name)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="mt-1 border-t pt-1">
            {naming ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); setNaming(false); setName(''); setOpen(false) } }}
                  placeholder="View name…"
                  className="flex-1 rounded border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => { if (name.trim()) { onSave(name.trim()); setNaming(false); setName(''); setOpen(false) } }}
                  className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
                >Save</button>
                <button onClick={() => setNaming(false)} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setNaming(true)} className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                <BookmarkPlus className="h-4 w-4" /> Save current view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function exportToCsv<TData>(table: ReturnType<typeof useReactTable<TData>>, filename: string) {
  const columns = table.getAllLeafColumns().filter(c => c.id !== 'actions' && c.getIsVisible())
  const headers = columns.map(c => (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id))
  const rows = table.getFilteredRowModel().rows.map(row =>
    columns.map(c => {
      const value = row.getValue(c.id)
      if (value == null) return ''
      const str = Array.isArray(value) ? value.join('; ') : String(value)
      return `"${str.replace(/"/g, '""')}"`
    })
  )
  const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = 'Search…',
  persistKey,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    if (!persistKey) return {}
    try {
      const raw = localStorage.getItem(`dt-cols-${persistKey}`)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })

  useEffect(() => {
    if (!persistKey) return
    localStorage.setItem(`dt-cols-${persistKey}`, JSON.stringify(columnVisibility))
  }, [columnVisibility, persistKey])

  const [views, setViews] = useState<SavedView[]>(() => {
    if (!persistKey) return []
    try {
      const raw = localStorage.getItem(`dt-views-${persistKey}`)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  function persistViews(next: SavedView[]) {
    setViews(next)
    if (persistKey) localStorage.setItem(`dt-views-${persistKey}`, JSON.stringify(next))
  }

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          {persistKey && (
            <ViewsMenu
              views={views}
              onApply={v => { setGlobalFilter(v.globalFilter); setSorting(v.sorting); setColumnVisibility(v.columnVisibility) }}
              onSave={name => persistViews([...views.filter(v => v.name !== name), { name, globalFilter, sorting, columnVisibility }])}
              onDelete={name => persistViews(views.filter(v => v.name !== name))}
            />
          )}
          <ColumnVisibilityMenu table={table} />
          <button
            onClick={() => exportToCsv(table, persistKey ?? 'export')}
            className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          className={cn('flex items-center gap-1', header.column.getCanSort() && 'cursor-pointer select-none hover:text-slate-800')}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            header.column.getIsSorted() === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> :
                            header.column.getIsSorted() === 'desc' ? <ChevronDown className="h-3.5 w-3.5" /> :
                            <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" />
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y">
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    No records found
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {table.getFilteredRowModel().rows.length} record{table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
