import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface TrendLineChartProps {
  title: string
  data: { label: string; value: number }[]
  formatValue?: (value: number) => string
  color?: string
}

export function TrendLineChart({ title, data, formatValue, color = '#2563eb' }: TrendLineChartProps) {
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {data.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">No data yet</p>
      ) : (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip
                formatter={(value) => [formatValue ? formatValue(Number(value)) : String(value ?? ''), '']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
