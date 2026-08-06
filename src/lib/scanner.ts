import { createContext, useContext } from 'react'

/** Open the viewfinder, and be told what the reader picked out of it. */
export type OpenScanner = (onPick: (text: string) => void) => void

/**
 * The viewfinder is owned above the panels rather than by one of them.
 *
 * It is a full-screen mode, and the thing that opened it is a button inside the
 * lookup panel — which the layout swaps between a drawer and a sidebar as the
 * phone turns. Owned there, turning the phone unmounted it and the camera shut
 * off mid-scan.
 */
export const ScannerContext = createContext<OpenScanner | null>(null)

export const useScanner = (): OpenScanner | null => useContext(ScannerContext)
