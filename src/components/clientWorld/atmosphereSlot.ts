import { createContext, useContext } from 'react'

/**
 * AppShell keeps an empty layer behind the page content (below the header,
 * beside the sidebar). A page can portal a backdrop into it, and read the
 * scrolling <main> for parallax.
 */
export interface AtmosphereSlot { layer: HTMLDivElement | null; scroller: HTMLElement | null }

export const AtmosphereContext = createContext<AtmosphereSlot>({ layer: null, scroller: null })

export const useAtmosphereSlot = () => useContext(AtmosphereContext)
