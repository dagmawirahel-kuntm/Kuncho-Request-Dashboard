// Starting points for a work order's parts, by trade. Picking one adds the
// usual parts with their units; quantities are left for the person who
// measured the job. Nothing here is required — they only save typing, so
// a job doesn't go out as one line that just repeats its name.

export interface WorkPreset {
  key: string
  label: string
  emoji: string
  parts: { description: string; unit: string }[]
}

export const WORK_PRESETS: WorkPreset[] = [
  { key: 'gypsum', label: 'Gypsum ceiling', emoji: '🏗️', parts: [
    { description: 'Ceiling framing (studs and channels)', unit: 'm²' },
    { description: 'Gypsum board fixing', unit: 'm²' },
    { description: 'Joint tape and filler', unit: 'm²' },
    { description: 'Cornice / cove', unit: 'm' },
    { description: 'Light and AC openings', unit: 'pcs' },
  ] },
  { key: 'painting', label: 'Painting', emoji: '🎨', parts: [
    { description: 'Surface preparation and putty', unit: 'm²' },
    { description: 'Primer coat', unit: 'm²' },
    { description: 'Finish coats', unit: 'm²' },
    { description: 'Touch-up after other trades', unit: '' },
  ] },
  { key: 'tiling', label: 'Tiling / ceramic', emoji: '🧱', parts: [
    { description: 'Screed / levelling', unit: 'm²' },
    { description: 'Floor tiles laid', unit: 'm²' },
    { description: 'Wall tiles laid', unit: 'm²' },
    { description: 'Skirting', unit: 'm' },
    { description: 'Grouting and cleaning', unit: 'm²' },
  ] },
  { key: 'flooring', label: 'Flooring (SPC / parquet)', emoji: '🪵', parts: [
    { description: 'Floor levelling', unit: 'm²' },
    { description: 'Underlay', unit: 'm²' },
    { description: 'Flooring laid', unit: 'm²' },
    { description: 'Skirting and trims', unit: 'm' },
  ] },
  { key: 'electrical', label: 'Electrical', emoji: '💡', parts: [
    { description: 'Conduit and wiring', unit: 'm' },
    { description: 'Sockets', unit: 'pcs' },
    { description: 'Switches', unit: 'pcs' },
    { description: 'Light fittings', unit: 'pcs' },
    { description: 'Distribution board', unit: 'pcs' },
    { description: 'Testing and handover', unit: '' },
  ] },
  { key: 'plumbing', label: 'Plumbing', emoji: '🚰', parts: [
    { description: 'Supply pipework', unit: 'm' },
    { description: 'Drain pipework', unit: 'm' },
    { description: 'Sanitary fittings', unit: 'pcs' },
    { description: 'Pressure test', unit: '' },
  ] },
  { key: 'joinery', label: 'Joinery / furniture', emoji: '🪚', parts: [
    { description: 'Shop drawings approved', unit: '' },
    { description: 'Cutting and assembly', unit: 'pcs' },
    { description: 'Finishing (veneer / lacquer)', unit: 'pcs' },
    { description: 'Delivery and installation', unit: 'pcs' },
    { description: 'Hardware (handles, hinges)', unit: 'pcs' },
  ] },
  { key: 'cladding', label: 'Wall cladding', emoji: '🧩', parts: [
    { description: 'Wall framing', unit: 'm²' },
    { description: 'Panels fixed', unit: 'm²' },
    { description: 'Trims and edges', unit: 'm' },
  ] },
  { key: 'aluminium', label: 'Aluminium & glass', emoji: '🪟', parts: [
    { description: 'Site measurement', unit: '' },
    { description: 'Frames fabricated', unit: 'pcs' },
    { description: 'Frames installed', unit: 'pcs' },
    { description: 'Glazing', unit: 'm²' },
    { description: 'Sealing', unit: 'm' },
  ] },
  { key: 'cleaning', label: 'Cleaning / handover', emoji: '🧹', parts: [
    { description: 'Debris removal', unit: 'trip' },
    { description: 'Deep clean', unit: 'room' },
    { description: 'Snag list cleared', unit: '' },
  ] },
]
