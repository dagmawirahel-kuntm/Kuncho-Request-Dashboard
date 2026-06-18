import { Info } from 'lucide-react'

export function OwnRecordsBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
      <Info className="h-3.5 w-3.5 shrink-0" />
      Showing only requests you submitted.
    </div>
  )
}
