import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DonutItem {
  label: string
  value: number
  color?: string
}

interface DonutChartProps {
  title: string
  items: DonutItem[]
  formatValue?: (value: number) => string
  emptyText?: string
}

const palette = ['#2563eb', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#06b6d4', '#94a3b8']

export function DonutChart({ title, items, formatValue, emptyText = 'No data yet' }: DonutChartProps) {
  const total = items.reduce((sum, i) => sum + i.value, 0)
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 || total === 0 ? (
        <p className="mt-10 mb-10 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={items} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                {items.map((item, i) => (
                  <Cell key={item.label} fill={item.color ?? palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatValue ? formatValue(Number(value)) : String(value ?? ''), '']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
