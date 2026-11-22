import { makeConverter, type ConvTable } from '@/lib/zhConv'

// 繁體 / 簡體 display. The app's text is Traditional everywhere (the data, the
// components); in 簡體 mode the text on screen is converted in place, so nothing
// that renders — verses, notes, outlines, the interface — has to know about it.
//   - A MutationObserver converts text nodes (and a few attributes) as they appear,
//     keeping each node's original so switching back restores it without a reload.
//   - Form fields are left alone: what the reader types stays as typed.
//   - Search and the 綱要 input read Simplified through toTraditional (s2t.ts).
// The Traditional→Simplified table is only fetched when 簡體 is chosen.

export type Script = 'hant' | 'hans'

const HAN = /[㐀-鿿豈-﫿]|[\u{20000}-\u{2ffff}]/u
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']
const SKIP = 'script,style,textarea,input,[contenteditable],[data-zh-skip]'

let convert: ((s: string) => string) | null = null
let observer: MutationObserver | null = null
let current: Script = 'hant'

// What a node held before we converted it, and what we turned it into — the
// second tells our own write apart from the page changing the node afterwards.
const textOrig = new WeakMap<Node, string>()
const textShown = new WeakMap<Node, string>()
const attrOrig = new WeakMap<Element, Map<string, string>>()
const attrShown = new WeakMap<Element, Map<string, string>>()

/** The text as it should read on screen — for what leaves the app (clipboard,
 * share), which is built from the data and so starts out Traditional. */
export function displayText(text: string): string {
  return current === 'hans' && convert ? convert(text) : text
}

/** A conversion that changes a string's length would move every offset into it
 * (selections, highlights), so such a result is not used. */
function convertSame(v: string): string {
  if (!convert || !HAN.test(v)) return v
  const c = convert(v)
  return c.length === v.length ? c : v
}

const skipped = (n: Node): boolean => !!(n.parentElement ?? (n as Element)).closest?.(SKIP)

function convertText(node: Node) {
  const v = node.nodeValue ?? ''
  if (v === textShown.get(node)) return // our own write
  if (skipped(node)) return
  const c = convertSame(v)
  if (c === v) {
    textOrig.delete(node)
    textShown.delete(node)
    return
  }
  textOrig.set(node, v)
  textShown.set(node, c)
  node.nodeValue = c
}

function convertAttr(el: Element, name: string) {
  const v = el.getAttribute(name)
  if (v == null || v === attrShown.get(el)?.get(name)) return
  const c = convertSame(v)
  if (c === v) return
  if (!attrOrig.has(el)) {
    attrOrig.set(el, new Map())
    attrShown.set(el, new Map())
  }
  attrOrig.get(el)!.set(name, v)
  attrShown.get(el)!.set(name, c)
  el.setAttribute(name, c)
}

function convertTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return convertText(root)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) convertText(n)
    else for (const a of ATTRS) convertAttr(n as Element, a)
  }
}

function restoreTree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const o = textOrig.get(n)
      if (o != null && n.nodeValue === textShown.get(n)) n.nodeValue = o
      textOrig.delete(n)
      textShown.delete(n)
    } else {
      const el = n as Element
      const orig = attrOrig.get(el)
      orig?.forEach((v, name) => {
        if (el.getAttribute(name) === attrShown.get(el)?.get(name)) el.setAttribute(name, v)
      })
      attrOrig.delete(el)
      attrShown.delete(el)
    }
  }
}

function observe() {
  observer?.disconnect()
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') convertText(r.target)
      else if (r.type === 'attributes') convertAttr(r.target as Element, r.attributeName!)
      else r.addedNodes.forEach(convertTree)
    }
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  })
}

/** Switch the page to `script`. Resolves once the table is ready and the page converted. */
export async function applyScript(script: Script): Promise<void> {
  current = script
  document.documentElement.lang = script === 'hans' ? 'zh-Hans' : 'zh-Hant'
  if (script === 'hant') {
    observer?.disconnect()
    observer = null
    restoreTree(document.body)
    return
  }
  if (!convert) {
    const mod = (await import('@/data/t2s.json')) as { default: ConvTable }
    convert = makeConverter(mod.default)
  }
  if (current !== 'hans') return // switched back while the table was loading
  observe()
  convertTree(document.body)
}
