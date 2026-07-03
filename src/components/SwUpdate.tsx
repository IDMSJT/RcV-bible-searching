import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Silent auto-update. registerType is 'prompt', so a new build parks the
 * service worker in `waiting` and flips `needRefresh` — instead of showing a
 * toast, we immediately skipWaiting + reload to it. No prompt to dismiss, no
 * need to fully close the PWA. The SW only checks for updates on launch /
 * reload (SPA route changes don't), so the reload happens at startup rather
 * than interrupting a read. Renders nothing. */
export function SwUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const applied = useRef(false)
  useEffect(() => {
    if (needRefresh && !applied.current) {
      applied.current = true
      void updateServiceWorker(true)
    }
  }, [needRefresh, updateServiceWorker])
  return null
}
