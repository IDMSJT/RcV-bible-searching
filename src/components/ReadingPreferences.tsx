import { useEffect } from 'react'
import { useLocalStorage } from '@/lib/useLocalStorage'

type Theme = 'light' | 'dark' | 'system'

// Invisible component that applies the user's reading preferences to the
// document. Lives at the root so the effects run once, but as its own
// component so theme / font-size updates only re-render here — not the whole
// app shell.
export function ReadingPreferences() {
  const [theme] = useLocalStorage<Theme>('rcv/theme', 'system')
  const [fontSize] = useLocalStorage('rcv/font-size', 16)

  useEffect(() => {
    document.documentElement.style.setProperty('--reading-fs', `${fontSize}px`)
  }, [fontSize])

  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.classList.toggle('dark', theme === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  return null
}
