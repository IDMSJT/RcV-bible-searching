import { useEffect } from 'react'
import { applyScript, type Script } from '@/lib/zhScript'
import { useLocalStorage } from '@/lib/useLocalStorage'

/** Applies the 繁體 / 簡體 setting to the whole page. Renders nothing. */
export function ScriptConverter() {
  const [script] = useLocalStorage<Script>('rcv/script', 'hant')
  useEffect(() => {
    void applyScript(script)
  }, [script])
  return null
}
