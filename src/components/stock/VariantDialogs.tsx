import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fieldCls } from '@/lib/formStyles'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { guessPack, useRefreshFamilies, useRefreshPrices, useStockFamilies, useStockItemsLite, type StockFamily } from '@/lib/stockFamilies'

const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'
const hint = 'mt-1 text-[11px] text-slate-400'

/**
 * Mark a stock item as a version of a product. Either the item is given
 * (from its own page) and the user picks what it's a version of, or the
 * product is given (its "Add a version") and the user picks the item.
 */
export function LinkVariantDialog({ item, family, onClose, onDone }: {
  item?: { id: string; item_name: string; unit: string }
  family?: StockFamily
  onClose: () => void
  onDone?: () => void
}) {
  const { toast } = useToast()
  const refresh = useRefreshFamilies()
  const { data: items = [] } = useStockItemsLite()
  const { data: families = [] } = useStockFamilies(!family)

  const [subjectId, setSubjectId] = useState<string | null>(item?.id ?? null)
  const [targetKey, setTargetKey] = useState<string | null>(null) // 'f:<id>' or 'i:<id>'
  // undefined = not typed yet, so the guess from the name shows.
  const [productName, setProductName] = useState<string>()
  const [baseUnit, setBaseUnit] = useState<string>()
  const [myLabel, setMyLabel] = useState<string>()
  const [myPack, setMyPack] = useState<string>()
  const [otherLabel, setOtherLabel] = useState<string>()
  const [otherPack, setOtherPack] = useState<string>()
  const [busy, setBusy] = useState(false)

  const subject = items.find(i => i.id === subjectId)
  const targetFamily = family ?? (targetKey?.startsWith('f:') ? families.find(f => f.id === targetKey.slice(2)) : undefined)
  const targetItem = targetKey?.startsWith('i:') ? items.find(i => i.id === targetKey.slice(2)) : undefined
  // An item already in a product joins that product.
  const joinFamily = targetFamily ?? (targetItem?.family_id ? families.find(f => f.id === targetItem.family_id) : undefined)
  const newFamily = !!targetItem && !targetItem.family_id

  const subjectName = subject?.item_name ?? item?.item_name ?? ''
  const myGuess = guessPack(subjectName)
  const otherGuess = targetItem ? guessPack(targetItem.item_name) : null
  const nameGuess = targetItem ? commonName(subjectName, targetItem.item_name) : ''

  const vProduct = productName ?? nameGuess
  const vBase = baseUnit ?? joinFamily?.base_unit ?? myGuess?.unit ?? otherGuess?.unit ?? ''
  const vMyLabel = myLabel ?? (myGuess ? `${myGuess.qty} ${myGuess.unit}` : '')
  const vMyPack = myPack ?? (myGuess && (!vBase || myGuess.unit === vBase) ? String(myGuess.qty) : '')
  const vOtherLabel = otherLabel ?? (otherGuess ? `${otherGuess.qty} ${otherGuess.unit}` : '')
  const vOtherPack = otherPack ?? (otherGuess && (!vBase || otherGuess.unit === vBase) ? String(otherGuess.qty) : '')

  const subjectOptions = useMemo(() => items
    .filter(i => i.family_id !== family?.id)
    .map(i => ({ id: i.id, label: i.item_name, sub: [i.item_code, i.unit, i.family_id ? 'in another product' : null].filter(Boolean).join(' · ') })), [items, family])
  const targetOptions = useMemo(() => [
    ...families.map(f => ({ id: `f:${f.id}`, label: `${f.name} — product`, sub: f.base_unit ? `compared per ${f.base_unit}` : 'product' })),
    ...items.filter(i => i.id !== subjectId).map(i => ({ id: `i:${i.id}`, label: i.item_name, sub: [i.item_code, i.unit, i.family_id ? 'already in a product' : null].filter(Boolean).join(' · ') })),
  ], [families, items, subjectId])

  const toolMix = !!subject && !!targetItem && subject.is_tool !== targetItem.is_tool
  const packOk = (v: string) => !v || Number(v) > 0
  const canConfirm = !!subjectId && (!!joinFamily || (newFamily && vProduct.trim().length > 1)) && !toolMix && packOk(vMyPack) && packOk(vOtherPack)

  async function save() {
    if (!subjectId) return
    setBusy(true)
    try {
      let familyId = joinFamily?.id ?? null
      if (!familyId && targetItem) {
        const { data, error } = await supabase.rpc('link_stock_item_variant', {
          p_item: targetItem.id, p_family_name: vProduct.trim(), p_label: vOtherLabel || null,
          p_pack_qty: vOtherPack ? Number(vOtherPack) : null, p_base_unit: vBase || null,
        })
        if (error) throw error
        familyId = data as string
      }
      const { error } = await supabase.rpc('link_stock_item_variant', {
        p_item: subjectId, p_family: familyId, p_label: vMyLabel || null,
        p_pack_qty: vMyPack ? Number(vMyPack) : null, p_base_unit: vBase || null,
      })
      if (error) throw error
      toast('Linked — their prices now sit side by side', 'success')
      refresh(subjectId); if (targetItem) refresh(targetItem.id)
      onDone?.(); onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally { setBusy(false) }
  }

  return (
    <ActionDialog title={family ? `Add a version of ${family.name}` : 'Link as a variant'} confirmLabel="Link" busy={busy} canConfirm={canConfirm}
      onClose={onClose} onConfirm={save}
      description="Each item keeps its own stock, code and history. Only their prices are compared — per litre, kg or metre when you give the size.">
      {!item && (
        <div>
          <span className={label}>Which stock item</span>
          <SearchableSelect value={subjectId} onChange={setSubjectId} options={subjectOptions} placeholder="Search stock items…" />
        </div>
      )}
      {!family && (
        <div>
          <span className={label}>{item ? `"${item.item_name}" is a version of` : 'A version of'}</span>
          <SearchableSelect value={targetKey} onChange={setTargetKey} options={targetOptions} placeholder="Another item, or a product…" />
          {targetItem?.family_id && joinFamily && <p className={hint}>That item is part of <b>{joinFamily.name}</b> — this joins it.</p>}
        </div>
      )}
      {toolMix && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">One is a tool and the other isn't — tools are tracked one by one, so they can't share a product.</p>}

      {newFamily && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <span className={label}>Product name</span>
              <input className={fieldCls} value={vProduct} onChange={e => setProductName(e.target.value)} placeholder="e.g. Jotun Egg White, MDF, Golden screw" />
            </div>
            <div>
              <span className={label}>Compare per</span>
              <input className={fieldCls} value={vBase} onChange={e => setBaseUnit(e.target.value)} placeholder="L, kg, m" />
            </div>
          </div>
          <Version name={targetItem!.item_name} unit={targetItem!.unit} base={vBase} lbl={vOtherLabel} pack={vOtherPack} onLabel={setOtherLabel} onPack={setOtherPack} />
        </>
      )}
      {joinFamily && !joinFamily.base_unit && (
        <div>
          <span className={label}>Compare per <span className="font-normal text-slate-400">(optional)</span></span>
          <input className={fieldCls} value={vBase} onChange={e => setBaseUnit(e.target.value)} placeholder="L, kg, m" />
        </div>
      )}
      {subjectId && <Version name={subjectName} unit={subject?.unit ?? item?.unit ?? ''} base={vBase} lbl={vMyLabel} pack={vMyPack} onLabel={setMyLabel} onPack={setMyPack} />}
    </ActionDialog>
  )
}

function Version({ name, unit, base, lbl, pack, onLabel, onPack }: {
  name: string; unit: string; base: string; lbl: string; pack: string; onLabel: (v: string) => void; onPack: (v: string) => void
}) {
  return (
    <div className="rounded-lg border p-3 dark:border-slate-700">
      <p className="mb-2 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{name}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={label}>What makes it different</span>
          <input className={fieldCls} value={lbl} onChange={e => onLabel(e.target.value)} placeholder="3 L tin, 18 mm, black" />
        </div>
        <div>
          <span className={label}>{base ? `${base} in one ${unit}` : `Size of one ${unit}`}</span>
          <input className={fieldCls} type="number" min="0" step="any" value={pack} onChange={e => onPack(e.target.value)} placeholder={base ? 'e.g. 3' : 'optional'} />
        </div>
      </div>
    </div>
  )
}

/** Change this item's label and size, or rename its product. */
export function EditVariantDialog({ item, family, onClose }: {
  item: { id: string; item_name: string; unit: string; variant_label: string | null; pack_qty: number | null }
  family: StockFamily
  onClose: () => void
}) {
  const { toast } = useToast()
  const refresh = useRefreshFamilies()
  const [name, setName] = useState(family.name)
  const [base, setBase] = useState(family.base_unit ?? '')
  const [lbl, setLbl] = useState(item.variant_label ?? '')
  const [pack, setPack] = useState(item.pack_qty != null ? String(item.pack_qty) : '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      if (name.trim() !== family.name || base.trim() !== (family.base_unit ?? '')) {
        const { error } = await supabase.rpc('rename_stock_item_family', { p_family: family.id, p_name: name.trim(), p_base_unit: base.trim() || null })
        if (error) throw error
      }
      const { error } = await supabase.rpc('link_stock_item_variant', {
        p_item: item.id, p_family: family.id, p_label: lbl.trim() || null, p_pack_qty: pack ? Number(pack) : null,
      })
      if (error) throw error
      toast('Saved', 'success'); refresh(item.id); onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <ActionDialog title="Edit variant" confirmLabel="Save" busy={busy} onClose={onClose} onConfirm={save}
      canConfirm={name.trim().length > 1 && (!pack || Number(pack) > 0)}>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <span className={label}>Product name</span>
          <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <span className={label}>Compare per</span>
          <input className={fieldCls} value={base} onChange={e => setBase(e.target.value)} placeholder="L, kg, m" />
        </div>
      </div>
      <Version name={item.item_name} unit={item.unit} base={base} lbl={lbl} pack={pack} onLabel={setLbl} onPack={setPack} />
    </ActionDialog>
  )
}

/** A price recorded against the wrong item moves to the right one. */
export function MovePriceDialog({ price, fromItemId, familyItemIds = [], onClose }: {
  price: { id: string; unit_price: number; sourced_at: string; vendor_name: string | null }
  fromItemId?: string
  familyItemIds?: string[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const refresh = useRefreshPrices()
  const { data: items = [] } = useStockItemsLite()
  const [to, setTo] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const siblings = new Set(familyItemIds)
  const options = items
    .filter(i => i.id !== fromItemId)
    .sort((a, b) => Number(siblings.has(b.id)) - Number(siblings.has(a.id)))
    .map(i => ({ id: i.id, label: i.item_name, sub: [siblings.has(i.id) ? 'same product' : null, i.item_code, `per ${i.unit}`].filter(Boolean).join(' · ') }))

  async function move() {
    if (!to) return
    setBusy(true)
    const { data, error } = await supabase.rpc('move_market_prices', { p_price_ids: [price.id], p_stock_item_id: to, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(data ? 'Price moved — both items\' trends are recalculated' : 'It was already on that item', 'success')
    refresh(); onClose()
  }

  return (
    <ActionDialog title="Move this price" confirmLabel="Move" busy={busy} canConfirm={!!to} onClose={onClose} onConfirm={move}
      description={`${formatCurrency(Number(price.unit_price))} · ${formatDate(price.sourced_at)}${price.vendor_name ? ` · ${price.vendor_name}` : ''} — for when it was really a different size or kind.`}>
      <div>
        <span className={label}>The item it really was</span>
        <SearchableSelect value={to} onChange={setTo} options={options} placeholder="Search stock items…" />
      </div>
      <div>
        <span className={label}>Why <span className="font-normal text-slate-400">(optional)</span></span>
        <input className={fieldCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. it was the 4 inch brush" />
      </div>
    </ActionDialog>
  )
}

/** The words two names share, as a first guess at the product name. */
function commonName(a: string, b: string) {
  const strip = (s: string) => s.replace(/(\d+(?:[.,]\d+)?)\s*(l|lt|ltr|litre|liter|kg|g|ml|mm|cm|m)\b/gi, ' ').replace(/[_]+/g, ' ')
  const bw = new Set(strip(b).toLowerCase().split(/\s+/).filter(Boolean))
  const words = strip(a).split(/\s+/).filter(w => w && bw.has(w.toLowerCase()))
  return words.join(' ') || a
}
