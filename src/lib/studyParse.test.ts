import { describe, expect, it } from 'vitest'
import { parseStudyLines } from './studyParse'
import { displayMarker } from './chinese'
import type { VerseRef } from './parseToken'

function sig(r: VerseRef): string {
  const ch =
    r.endChapter !== r.chapter ? `${r.chapter}-${r.endChapter}` : `${r.chapter}`
  let v = `${r.verseStart}`
  if (r.verseEnd !== r.verseStart) v += `-${r.verseEnd}`
  if (r.seg === 0) v += '上'
  else if (r.seg === 1) v += '下'
  if (r.note != null) v += r.noteDirect ? `註${r.note}` : `與註${r.note}`
  return `${r.bookNo}:${ch}:${v}`
}

const refSigs = (refs: VerseRef[]) => refs.map(sig)

describe('parseStudyLines — line kinds', () => {
  it('empty line', () => {
    expect(parseStudyLines('')).toEqual([{ kind: 'empty' }])
  })

  it('week heading (bracketed legacy form)', () => {
    expect(parseStudyLines('【週一】')).toEqual([{ kind: 'week' }])
  })

  it('week heading (spaced new-style form)', () => {
    expect(parseStudyLines('週　一')).toEqual([{ kind: 'week' }])
  })

  it('reading line carries the original text + parsed refs', () => {
    const lines = parseStudyLines('讀經：太一1，二5')
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('reading')
    if (lines[0].kind !== 'reading') throw new Error('typecheck')
    expect(lines[0].text).toBe('讀經：太一1，二5')
    expect(refSigs(lines[0].refs)).toEqual(['40:1:1', '40:2:5'])
  })

  it('title lines render before the 讀經 line', () => {
    const lines = parseStudyLines(['第一週', '基督是身體', '讀經：太一1'].join('\n'))
    expect(lines[0]).toEqual({ kind: 'title', text: '第一週' })
    expect(lines[1]).toEqual({ kind: 'title', text: '基督是身體' })
    expect(lines[2].kind).toBe('reading')
  })
})

describe('parseStudyLines — point markers + levels', () => {
  it('壹 marker → level 1', () => {
    const [p] = parseStudyLines('壹、本週的綱要')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(1)
    expect(p.marker).toBe('壹')
  })

  it('一 marker → level 2', () => {
    const [p] = parseStudyLines('一、第一點')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(2)
    expect(p.marker).toBe('一')
  })

  it('arabic marker → level 3', () => {
    const [p] = parseStudyLines('1. 第三層')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(3)
    expect(p.marker).toBe('1')
  })

  it('alpha marker → level 4', () => {
    const [p] = parseStudyLines('A. 第四層')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(4)
    expect(p.marker).toBe('A')
  })
})

describe('parseStudyLines — ref regions in point lines', () => {
  it('refs after a dash are picked up', () => {
    const [p] = parseStudyLines('壹、神人生活—太一1，二5')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['40:1:1', '40:2:5'])
  })

  it('refs inside (…) are picked up', () => {
    const [p] = parseStudyLines('壹、神人生活（太一1）')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['40:1:1'])
  })

  it('full book name in prose seeds ctx for a chapterless trailing ref', () => {
    // 「叁　羅馬書...— 一17」: parseToken on 「一17」 needs a book — the
    // 羅馬書 in prose seeds ctx so the ref binds correctly to Romans.
    const [p] = parseStudyLines('叁、羅馬書的盼望—一17')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['45:1:17'])
  })

  it('啓 normalises to 啟 in outline copy-paste', () => {
    const [p] = parseStudyLines('壹、得勝—啓二一23')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23'])
  })

  it('full-width （ ） normalise to half-width', () => {
    const [p] = parseStudyLines('壹、得勝（啟二一23）')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23'])
  })

  it('appositive dashes in the heading do not swallow the trailing refs', () => {
    // 「永遠的生命──三一神──裏作王──羅五18下」: the region regex starts at the
    // FIRST dash, but the real refs sit after the LAST one. Prose before that
    // dash gets peeled so 羅五18下 (+ inherited 21下, 約壹五11～12) still parse.
    const [p] = parseStudyLines(
      '一　救贖神的選民，甚至在永遠的生命──三一神──裏作王──羅五18下，21下，約壹五11～12。',
    )
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['45:5:18下', '45:5:21下', '62:5:11-12'])
  })

  it('an em-dash range stays a range, not a heading split (太一1—3)', () => {
    // The guard only peels prose-led dashes, so 1—3 (digits on both sides)
    // is left as a range and never mis-split into prose + verse.
    const [p] = parseStudyLines('壹、起頭—太一1—3')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['40:1:1-3'])
  })
})

describe('parseStudyLines — 與(?![注註]) splitter', () => {
  it('「詩四八2與註1」 stays together so 與註1 attaches as the note', () => {
    const [p] = parseStudyLines('叁、復興—詩四八2與註1，啟三12、21：')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual([
      '19:48:2與註1',
      '66:3:12',
      '66:3:21',
    ])
  })

  it('「詩四八2與五10」 splits — 與 between two refs still separates them', () => {
    const [p] = parseStudyLines('叁、合一—詩四八2與五10')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['19:48:2', '19:5:10'])
  })

  it('direct 「啟二一23註1」 in an outline parses as a direct-note ref', () => {
    const [p] = parseStudyLines('叁、新城—啟二一23註1')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23註1'])
  })

  it('per-verse notes across a 、 list (啟二1注3、2注1)', () => {
    // Compose must match the lookup panel: 注3 on Rev 2:1, 注1 on Rev 2:2.
    const [p] = parseStudyLines('叁、x—啟二1注3、2注1')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:2:1註3', '66:2:2註1'])
  })
})

describe('parseStudyLines — fully-spelled 讀經 reading list', () => {
  const reading = (refs: string) => {
    const [p] = parseStudyLines(`讀經：${refs}`)
    if (p.kind !== 'reading') throw new Error('typecheck')
    return refSigs(p.refs)
  }

  it('「節下 / 節上」 (segment marker after 節) is kept, not dropped', () => {
    // The 節 sits BEFORE the 上/下 — earlier code only stripped a trailing 節.
    expect(reading('羅馬書五章十八節下，二十一節下')).toEqual(['45:5:18下', '45:5:21下'])
    expect(reading('歌羅西書三章四節上')).toEqual(['51:3:4上'])
  })

  it('all-CN verse range is not mis-split into a cross-chapter range', () => {
    // 「十一至十二」 must stay 5:11-12, not become 5:11–10:2.
    expect(reading('約翰一書五章十一至十二節')).toEqual(['62:5:11-12'])
    expect(reading('希伯來書十章十九至二十節')).toEqual(['58:10:19-20'])
    expect(reading('腓立比書二章十五至十六節')).toEqual(['50:2:15-16'])
  })

  it('CN-chapter + arabic-verse cross-chapter range still works (十一36～十二5)', () => {
    expect(reading('馬太福音十一章36～十二5')).toEqual(['40:11-12:36-5'])
  })

  it('trailing 。 on the final ref does not drop it', () => {
    expect(reading('馬太福音五章十六節。')).toEqual(['40:5:16'])
  })

  it('parses the whole fully-spelled reading line (16 refs)', () => {
    expect(
      reading(
        '羅馬書五章十八節下，二十一節下，約翰一書五章十一至十二節，羅馬書五章十節，' +
          '使徒行傳十一章十八節，創世記三章二十四節，希伯來書十章十九至二十節 ，啟示錄二章七節，' +
          '希伯來書四章十六節，以弗所書十九章三節，約翰福音一章十二至十三節，歌羅西書三章四節上，' +
          '彼得後書一章四節下，約翰一書四章十三節，腓立比書二章十五至十六節，馬太福音五章十六節。',
      ),
    ).toEqual([
      '45:5:18下',
      '45:5:21下',
      '62:5:11-12',
      '45:5:10',
      '44:11:18',
      '1:3:24',
      '58:10:19-20',
      '66:2:7',
      '58:4:16',
      '49:19:3',
      '43:1:12-13',
      '51:3:4上',
      '61:1:4下',
      '62:4:13',
      '50:2:15-16',
      '40:5:16',
    ])
  })

  it('appositive-dash ref wins over a prior book in ctx (神人類—約一1 ≠ 弗)', () => {
    // 弗 on the first line leaves Ephesians in ctx; the second line's
    // 「神人類—約一1、14」 must peel to 約翰, not grab 「1」 as 弗1. Then 十二24
    // continues in 約翰, not 弗12 (which doesn't exist → would render red).
    const lines = parseStudyLines(
      ['壹　基督—弗一14', '2　新的一類—神人類—約一1、14，十二24。'].join('\n'),
    )
    const pts = lines.filter((l): l is Extract<typeof l, { kind: 'point' }> => l.kind === 'point')
    expect(refSigs(pts[1].refs)).toEqual(['43:1:1', '43:1:14', '43:12:24'])
  })
})

describe('parseStudyLines — bracket width', () => {
  const points = (s: string) =>
    parseStudyLines(s).filter((l): l is Extract<typeof l, { kind: 'point' }> => l.kind === 'point')

  it('reads a marker written either width, at the same level', () => {
    expect(points('（一）\u3000標題').map((p) => [p.marker, p.level])).toEqual([['（一）', 5]])
    expect(points('(一)\u3000標題').map((p) => [p.marker, p.level])).toEqual([['(一)', 5]])
  })

  it('leaves the body alone — only displayMarker folds, and only the marker', () => {
    // Folding up front rewrote the text every segment is sliced from, so an
    // aside in the prose came out half-width along with the marker.
    expect(points('（一）\u3000污靈（鬼）').map((p) => p.segments.map((s) => s.text).join(''))).toEqual([
      '污靈（鬼）',
    ])
    expect(displayMarker('（一）')).toBe('(一)')
  })

  it('still expands a precomposed enclosed numeral', () => {
    expect(points('㈡\u3000標題').map((p) => [p.marker, p.level])).toEqual([['（二）', 5]])
  })
})
