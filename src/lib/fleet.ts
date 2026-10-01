// Vehicle and driver papers (migration 389).

export const PAPER_KINDS = [
  { value: 'plate',          label: 'Plate',              forDriver: false, expires: false },
  { value: 'insurance',      label: 'Insurance',          forDriver: false, expires: true },
  { value: 'inspection',     label: 'Annual inspection',  forDriver: false, expires: true },
  { value: 'road_fund',      label: 'Road fund',          forDriver: false, expires: true },
  { value: 'libre',          label: 'Libre (ownership)',  forDriver: false, expires: false },
  { value: 'driver_licence', label: "Driver's licence",   forDriver: true,  expires: true },
  { value: 'other',          label: 'Other',              forDriver: false, expires: true },
] as const

export type PaperKind = (typeof PAPER_KINDS)[number]['value']

export const PAPER_LABEL: Record<string, string> = Object.fromEntries(PAPER_KINDS.map(k => [k.value, k.label]))

export type FleetPaper = {
  vehicle_id: string | null
  staff_id: string | null
  kind: PaperKind
  holder: string
  document_id: string | null
  reference: string | null
  issued_on: string | null
  expires_on: string | null
  file_url: string | null
  state: 'missing' | 'expired' | 'due' | 'ok'
  days_left: number | null
}

export function paperStateText(p: Pick<FleetPaper, 'state' | 'days_left' | 'expires_on'>) {
  if (p.state === 'missing') return 'Not on file'
  if (p.state === 'expired') return `Expired ${Math.abs(p.days_left ?? 0)} day${Math.abs(p.days_left ?? 0) === 1 ? '' : 's'} ago`
  if (p.state === 'due') return `Expires in ${p.days_left} day${p.days_left === 1 ? '' : 's'}`
  return p.expires_on ? 'Valid' : 'On file'
}
