import type { ReactNode } from 'react'

/** The app's single scrolling region. It lives inside the non-scrolling
 * <main> so that sibling page headers (the chapter / outline titles) stay
 * fixed in place instead of scrolling away. Carries the
 * data-scroll-restoration-id that the router's scrollToTopSelectors and the
 * sessionStorage restoration code in __root key off — keep it here, in one
 * place, since exactly one ScrollBody is mounted at a time. */
export function ScrollBody({ children }: { children: ReactNode }) {
  return (
    <div
      data-scroll-restoration-id="main"
      className="min-h-0 flex-1 overflow-y-auto pb-[var(--nav-h)] md:pb-0 print:overflow-visible print:pb-0"
    >
      {children}
    </div>
  )
}
