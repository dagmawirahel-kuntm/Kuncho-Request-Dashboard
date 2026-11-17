// Who takes (or hands over) the goods, and their signature (529).
export type SignerKind = 'driver' | 'me' | 'other'
export interface CollectionSign {
  kind: SignerKind
  driverId: string | null
  name: string
  phone: string
  plate: string
  signature: string | null
}
export const EMPTY_SIGN: CollectionSign = { kind: 'driver', driverId: null, name: '', phone: '', plate: '', signature: null }

/** Ready to save: a signature and a name. */
export const isSigned = (s: CollectionSign) => !!s.signature && s.name.trim().length > 0
