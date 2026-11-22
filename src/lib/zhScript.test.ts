// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { applyScript, displayText } from './zhScript'

const tick = () => new Promise((r) => setTimeout(r, 10))

afterEach(async () => {
  await applyScript('hant')
  document.body.innerHTML = ''
})

describe('applyScript', () => {
  it('converts the page to 簡體 and restores it', async () => {
    document.body.innerHTML = '<p id="a">神愛世人，著重經歷</p><button aria-label="關閉註釋 1">x</button>'
    await applyScript('hans')
    const p = document.getElementById('a')!
    expect(p.textContent).toBe('神爱世人，著重经历')
    expect(document.querySelector('button')!.getAttribute('aria-label')).toBe('关闭注释 1')
    expect(document.documentElement.lang).toBe('zh-Hans')

    await applyScript('hant')
    expect(p.textContent).toBe('神愛世人，著重經歷')
    expect(document.querySelector('button')!.getAttribute('aria-label')).toBe('關閉註釋 1')
    expect(document.documentElement.lang).toBe('zh-Hant')
  })

  it('converts text that arrives later, and text the page rewrites', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    await applyScript('hans')
    const root = document.getElementById('root')!
    const span = document.createElement('span')
    span.textContent = '約翰福音'
    root.appendChild(span)
    await tick()
    expect(span.textContent).toBe('约翰福音')

    span.firstChild!.nodeValue = '創世記' // what a re-render does
    await tick()
    expect(span.textContent).toBe('创世记')
  })

  it('leaves form fields as typed', async () => {
    document.body.innerHTML = '<textarea id="t">約翰福音</textarea><div data-zh-skip>經文</div>'
    await applyScript('hans')
    expect(document.getElementById('t')!.textContent).toBe('約翰福音')
    expect(document.querySelector('[data-zh-skip]')!.textContent).toBe('經文')
  })

  it('does not change a node it cannot convert in place without moving offsets', async () => {
    document.body.innerHTML = '<p id="a">一二三</p>'
    await applyScript('hans')
    expect(document.getElementById('a')!.textContent).toBe('一二三')
  })
})

describe('displayText', () => {
  it('follows the script on screen', async () => {
    expect(displayText('神愛世人')).toBe('神愛世人')
    await applyScript('hans')
    expect(displayText('神愛世人')).toBe('神爱世人')
    await applyScript('hant')
    expect(displayText('神愛世人')).toBe('神愛世人')
  })
})
