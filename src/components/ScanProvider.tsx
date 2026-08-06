import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react'
import { ScannerContext, type OpenScanner } from '@/lib/scanner'

// Pulls in the recogniser, so it loads on the first scan and never before.
const ScanCamera = lazy(() =>
  import('@/components/ScanCamera').then((m) => ({ default: m.ScanCamera })),
)

/** Holds the viewfinder for whoever asks — see ScannerContext for why here. */
export function ScanProvider({ children }: { children: ReactNode }) {
  const [pick, setPick] = useState<{ fn: (text: string) => void } | null>(null)
  const close = useCallback(() => setPick(null), [])
  const open = useCallback<OpenScanner>((onPick) => setPick({ fn: onPick }), [])
  return (
    <ScannerContext.Provider value={open}>
      {children}
      {pick && (
        <Suspense fallback={null}>
          <ScanCamera
            onPick={(text) => {
              close()
              pick.fn(text)
            }}
            onClose={close}
          />
        </Suspense>
      )}
    </ScannerContext.Provider>
  )
}
