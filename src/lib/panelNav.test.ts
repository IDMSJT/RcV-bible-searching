import { describe, expect, test } from 'vitest'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { modeOf, panelNav, panelOfPane, paneOf, parsePanel, withoutPanel } from './panelNav'

const tick = () => new Promise((r) => setTimeout(r, 0))

// There is no <RouterProvider> here to follow the history, so after anything
// that moves it the router is told to re-read it.
async function setup(initial: string) {
  const history = createMemoryHistory({ initialEntries: [initial] })
  const router = createRouter({ routeTree, history })
  await router.load()
  const nav = panelNav(router)
  const settled = async () => {
    await tick()
    await router.load()
  }
  const where = () => {
    const l = router.state.location
    return `${l.pathname}${l.search.panel ? `?panel=${l.search.panel}` : ''}`
  }
  // Back as far as it goes, reporting every stop — the whole history, newest first.
  const unwind = async () => {
    const seen = [where()]
    while (history.canGoBack()) {
      history.back()
      await settled()
      seen.push(where())
    }
    return seen
  }
  return { router, history, nav, settled, where, unwind }
}

describe('panel param', () => {
  test('unknown values are ignored', async () => {
    const { router } = await setup('/40/1?panel=bogus')
    expect(router.state.matches.at(-1)?.search.panel).toBeUndefined()
    expect(parsePanel('bogus')).toBeUndefined()
  })

  test('catalog panes map to panels and back', () => {
    expect([0, 1, 2].map((p) => panelOfPane(p as 0 | 1 | 2))).toEqual(['books', 'chapters', 'charts'])
    expect(paneOf('books')).toBe(0)
    expect(paneOf('charts')).toBe(2)
    expect(paneOf('settings')).toBe(1)
    expect(paneOf(undefined)).toBe(1)
    expect(modeOf('charts')).toBe('catalog')
    expect(modeOf('settings')).toBe('settings')
  })

  test('withoutPanel keeps the rest of the query', () => {
    expect(withoutPanel('/40/1?panel=chapters')).toBe('/40/1')
    expect(withoutPanel('/40/1?hl=3&panel=books')).toBe('/40/1?hl=3')
    expect(withoutPanel('/40/1')).toBe('/40/1')
  })
})

describe('opening and dismissing', () => {
  test('opening pushes one entry on the same page', async () => {
    const { nav, settled, where, unwind } = await setup('/40/1')
    nav.open('chapters')
    await settled()
    expect(where()).toBe('/40/1?panel=chapters')
    expect(nav.isOpen()).toBe(true)
    expect(await unwind()).toEqual(['/40/1?panel=chapters', '/40/1'])
  })

  test('dismissing goes back, leaving the page as it was', async () => {
    const { nav, settled, where, unwind } = await setup('/40/1')
    nav.open('chapters')
    await settled()
    nav.close()
    await settled()
    expect(where()).toBe('/40/1')
    expect(nav.isOpen()).toBe(false)
    expect(await unwind()).toEqual(['/40/1'])
  })

  test('switching panels while open replaces — one entry however many panes', async () => {
    const { nav, settled, where, unwind } = await setup('/40/1')
    nav.open('chapters')
    await settled()
    nav.open('books')
    await settled()
    nav.open('charts')
    await settled()
    expect(where()).toBe('/40/1?panel=charts')
    expect(await unwind()).toEqual(['/40/1?panel=charts', '/40/1'])
  })

  test('dismissing after switching panels still goes back to the page', async () => {
    const { nav, settled, where, unwind } = await setup('/40/1')
    nav.open('chapters')
    await settled()
    nav.open('books')
    await settled()
    nav.close()
    await settled()
    expect(where()).toBe('/40/1')
    expect(await unwind()).toEqual(['/40/1'])
  })

  test('a drawer that was not pushed (reload, shared link) is stripped in place', async () => {
    const { nav, settled, where, unwind } = await setup('/40/1?panel=books')
    nav.close()
    await settled()
    expect(where()).toBe('/40/1')
    expect(await unwind()).toEqual(['/40/1'])
  })

  test('close with nothing open does nothing', async () => {
    const { nav, settled, where } = await setup('/40/1')
    nav.close()
    await settled()
    expect(where()).toBe('/40/1')
  })

  test('the drawer opens over any page, charts included', async () => {
    const { nav, settled, where } = await setup('/charts/2')
    nav.open('settings')
    await settled()
    expect(where()).toBe('/charts/2?panel=settings')
    nav.close()
    await settled()
    expect(where()).toBe('/charts/2')
  })
})

describe('leaving the drawer for another page', () => {
  test('a chapter picked with replace takes the drawer entry over', async () => {
    const { router, nav, settled, where, unwind } = await setup('/40/1')
    nav.open('chapters')
    await settled()
    await router.navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo: 43, chapterNo: 3 },
      search: {},
      replace: nav.isOpen(),
    })
    expect(where()).toBe('/43/3')
    // Back from the new chapter is the old one — no stop at the drawer.
    expect(await unwind()).toEqual(['/43/3', '/40/1'])
  })

  test('a chart opened from the drawer is one back-step from the drawer', async () => {
    const { router, nav, settled, where, unwind } = await setup('/40/1')
    nav.open('charts')
    await settled()
    await router.navigate({ to: '/charts/$n', params: { n: '1' } })
    expect(where()).toBe('/charts/1')
    expect(await unwind()).toEqual(['/charts/1', '/40/1?panel=charts', '/40/1'])
  })

  test('back from a chart reopens the drawer, and dismissing that lands on the page under it', async () => {
    const { router, history, nav, settled, where, unwind } = await setup('/40/1')
    nav.open('charts')
    await settled()
    await router.navigate({ to: '/charts/$n', params: { n: '1' } })
    history.back()
    await settled()
    expect(where()).toBe('/40/1?panel=charts')
    expect(nav.isOpen()).toBe(true)
    nav.close()
    await settled()
    expect(where()).toBe('/40/1')
    expect(await unwind()).toEqual(['/40/1'])
  })

  test('a book picked inside the drawer moves the page, so dismissing strips rather than goes back', async () => {
    const { router, nav, settled, where, unwind } = await setup('/40/1')
    nav.open('books')
    await settled()
    // What a book cell does: stay in the drawer (now on its chapters), replace.
    await router.navigate({
      to: '/$bookNo',
      params: { bookNo: 41 },
      search: { panel: 'chapters' },
      replace: true,
    })
    expect(where()).toBe('/41?panel=chapters')
    nav.close()
    await settled()
    expect(where()).toBe('/41')
    expect(await unwind()).toEqual(['/41', '/40/1'])
  })

  test('a link that names no search drops the drawer', async () => {
    const { router, nav, settled, where } = await setup('/40/1')
    nav.open('settings')
    await settled()
    await router.navigate({ to: '/search', replace: true })
    expect(where()).toBe('/search')
    expect(nav.isOpen()).toBe(false)
  })
})
