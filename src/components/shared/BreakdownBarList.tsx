interface BreakdownItem {
  label: string
  value: number
  color?: string
}

interface BreakdownBarListProps {
  title: string
  items: BreakdownItem[]
  formatValue?: (value: number) => string
  emptyText?: string
}

const palette = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-slate-400']

export function BreakdownBarList({ title, items, formatValue, emptyText = 'No data yet' }: BreakdownBarListProps) {
  const max = Math.max(1, ...items.map(i => i.value))
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item, i) => (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{item.label}</span>
                <span className="text-slate-500">{formatValue ? formatValue(item.value) : item.value}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${item.color ?? palette[i % palette.length]}`}
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
