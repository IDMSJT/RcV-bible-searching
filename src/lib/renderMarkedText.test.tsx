import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMarkedText } from './renderVerse'

const plain = (node: ReturnType<typeof renderMarkedText>) =>
  renderToStaticMarkup(<>{node}</>)
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')

describe('renderMarkedText', () => {
  // 加四2: cross-reference c sits between the two characters of the 補字 「的手」.
  const text = '乃是在監護人和管家的手下，直到父親所豫定的時候。'

  it('keeps all the text when a marker sits inside a mark', () => {
    const out = renderMarkedText(
      text,
      [{ k: 'add', s: 9, e: 11 }],
      [{ n: 1, offsets: [3], text: '' }],
      [
        { m: 'a', offsets: [3], refs: '' },
        { m: 'c', offsets: [10], refs: '' },
      ],
    )
    expect(plain(out)).toBe(text)
    expect(renderToStaticMarkup(<>{out}</>)).toContain('>c</sup>')
  })

  it('keeps all the text when two marks overlap', () => {
    const out = renderMarkedText(text, [
      { k: 'add', s: 2, e: 6 },
      { k: 'pn', s: 4, e: 8 },
    ])
    expect(plain(out)).toBe(text.slice(0, 6) + text.slice(6))
  })
})
