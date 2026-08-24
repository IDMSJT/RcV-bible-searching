import { createFileRoute } from '@tanstack/react-router'
import { LookupPanel } from '@/components/LookupPanel'
import { useIsMobile } from '@/lib/useIsMobile'

export const Route = createFileRoute('/search')({
  component: SearchPage,
})

// Search is a page only on the phone. On desktop it lives in the aside beside
// the reading view, so a desktop visit to /search is bounced back to the last
// chapter (see __root) with the aside opened there — this renders nothing in
// the meantime rather than flashing a full-width search page the layout never
// wants at that width.
function SearchPage() {
  const isMobile = useIsMobile()
  if (!isMobile) return null
  // Reserve the fixed bottom nav's height the way the drawer used to, so the
  // results' own sticky copy bar clears it. The panel keeps its inner scroll;
  // this wrapper only holds it above the nav.
  return (
    <div className="h-full pb-[calc(var(--nav-h)-1px)]">
      <LookupPanel />
    </div>
  )
}
