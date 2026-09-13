import type { FolderProjectDocument } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import {
  isSafeAssetImagePath,
  isSafeCardImagePath,
  isSafeProjectPath,
  parseFolderProject,
  serializeFolderProject,
} from '~/services/project/format'

function document(): FolderProjectDocument {
  return {
    version: 2,
    name: 'カード翻訳',
    activeCardId: 'card-1',
    cards: [
      {
        id: 'card-1',
        imagePath: 'images/card-1.png',
        imageName: 'card.png',
        imageWidth: 100,
        imageHeight: 200,
        regions: [],
        printArea: null,
        sourceDpi: null,
      },
    ],
    assets: [],
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
  }
}

describe('folder project format', () => {
  it('round trips source icon anchors and rejects malformed markers', () => {
    const value = document()
    value.cards[0]!.regions = [{ id: 'r', ruby: true, rubyFontSize: 12, rubyGap: -3, sourceIcons: [{ id: 'i', assetId: 'a', x: 10, y: 20, width: 30, height: 40 }] }] as never
    const parsed = parseFolderProject(JSON.stringify(value))
    expect(parsed.cards[0]!.regions[0]).toMatchObject({ ruby: true, rubyFontSize: 12, rubyGap: -3 })
    expect(parsed.cards[0]!.regions[0]!.sourceIcons).toEqual(value.cards[0]!.regions[0]!.sourceIcons)
    expect(parseFolderProject(serializeFolderProject(parsed))).toEqual(parsed)
    value.cards[0]!.regions[0]!.sourceIcons![0]!.width = 0
    expect(() => parseFolderProject(JSON.stringify(value))).toThrow('元画像のアイコン')
  })

  it('round trips region roles including arbitrary labels and legacy unassigned regions', () => {
    const value = document()
    const roles = ['  フレーバーテキスト  ', '任務条件', 'all', 'unassigned', '', undefined, 42]
    value.cards[0]!.regions = roles.map((role, index) => ({
      id: `r${index}`,
      regionId: `region_${index}`,
      role,
    })) as unknown as FolderProjectDocument['cards'][number]['regions']
    const parsed = parseFolderProject(JSON.stringify(value))
    expect(parsed.cards[0]!.regions.map(region => region.role)).toEqual([
      'フレーバーテキスト',
      '任務条件',
      'all',
      'unassigned',
      undefined,
      undefined,
      undefined,
    ])
    expect(parseFolderProject(serializeFolderProject(parsed))).toEqual(parsed)
  })

  it('serializes and parses a project document', () => {
    expect(parseFolderProject(serializeFolderProject(document()))).toEqual(
      document(),
    )
  })

  it('uses the first card when activeCardId is missing', () => {
    const value = document()
    value.activeCardId = 'missing'
    expect(parseFolderProject(JSON.stringify(value)).activeCardId).toBe(
      'card-1',
    )
  })

  it('normalizes valid glossary entries and rejects incomplete ones', () => {
    const value = document()
    value.glossary = [
      { id: 'draw', source: ' Draw ', translation: ' 引く ', note: ' 動詞 ' },
    ]

    expect(parseFolderProject(JSON.stringify(value)).glossary).toEqual([
      { id: 'draw', source: 'Draw', translation: '引く', note: '動詞' },
    ])

    value.glossary.push({
      id: 'empty',
      source: '',
      translation: '無効',
      note: '',
    })
    expect(() => parseFolderProject(JSON.stringify(value))).toThrow(
      'glossary[1]が不正',
    )
  })

  it('migrates legacy version 0 and unversioned card collections', () => {
    for (const version of [0, undefined]) {
      const value = document() as unknown as Record<string, unknown>
      if (version === undefined)
        delete value.version
      else value.version = version
      delete value.activeCardId
      delete value.ocrDictionary
      delete value.glossary

      const parsed = parseFolderProject(JSON.stringify(value))

      expect(parsed.version).toBe(2)
      expect(parsed.activeCardId).toBe('card-1')
      expect(parsed.ocrDictionary).toEqual([])
      expect(parsed.glossary).toEqual([])
    }
  })

  it('migrates version 1 projects without print settings', () => {
    const value = document() as unknown as Record<string, unknown>
    value.version = 1
    delete value.printSettings
    const cards = value.cards as Array<Record<string, unknown>>
    cards.forEach((card) => {
      delete card.printArea
      delete card.sourceDpi
    })

    const parsed = parseFolderProject(JSON.stringify(value))

    expect(parsed.version).toBe(2)
    expect(parsed.cards[0]!.printArea).toBeNull()
    expect(parsed.cards[0]!.sourceDpi).toBeNull()
    expect(parsed.printSettings).toEqual({
      columns: 3,
      marginMm: 10,
      gapMm: 1,
      cutMarks: true,
    })
  })

  it('rejects unsupported and empty projects', () => {
    expect(() => parseFolderProject('{')).toThrow('正しいJSON')
    expect(() =>
      parseFolderProject(JSON.stringify({ version: 3, cards: [] })),
    ).toThrow('対応していない')
    expect(() =>
      parseFolderProject(JSON.stringify({ version: 2, cards: [] })),
    ).toThrow('読み込めるカード')
  })

  it('allows only relative paths contained in the project folder', () => {
    expect(isSafeProjectPath('images/card.png')).toBe(true)
    expect(isSafeProjectPath('../card.png')).toBe(false)
    expect(isSafeProjectPath('/images/card.png')).toBe(false)
    expect(isSafeProjectPath('images//card.png')).toBe(false)
  })

  it('allows only flat image and asset paths with approved extensions', () => {
    expect(isSafeCardImagePath('images/card-id.png')).toBe(true)
    expect(isSafeCardImagePath('images/card-id.jpg')).toBe(true)
    expect(isSafeCardImagePath('images/card-id.jpeg')).toBe(true)
    expect(isSafeAssetImagePath('assets/asset-id.png')).toBe(true)

    for (const path of [
      '../outside.png',
      '/absolute.png',
      'other/valuable.png',
      'images/nested/card.png',
      'images/card.svg',
    ]) {
      expect(isSafeCardImagePath(path)).toBe(false)
    }
    expect(isSafeAssetImagePath('assets/nested/asset.png')).toBe(false)
    expect(isSafeAssetImagePath('assets/asset.jpg')).toBe(false)
  })

  it('rejects a project whose cards only reference unsafe image paths', () => {
    const value = document()
    value.cards[0]!.imagePath = 'other/valuable.png'

    expect(() => parseFolderProject(JSON.stringify(value))).toThrow(
      'cards[0]が不正',
    )
  })

  it('rejects invalid collection items instead of silently discarding them', () => {
    const value = document() as unknown as Record<string, unknown>
    value.assets = [{ id: 'broken-asset' }]

    expect(() => parseFolderProject(JSON.stringify(value))).toThrow(
      'assets[0]が不正',
    )
  })

  it('rejects duplicate persistent and CSV identifiers', () => {
    const duplicateCard = document()
    duplicateCard.cards.push({ ...duplicateCard.cards[0]! })
    expect(() => parseFolderProject(JSON.stringify(duplicateCard))).toThrow(
      'カードID「card-1」が重複',
    )

    const duplicateRegionId = document()
    duplicateRegionId.cards[0]!.regions = [
      { id: 'first', regionId: 'text-1' },
      { id: 'second', regionId: 'text-1' },
    ] as never
    expect(() => parseFolderProject(JSON.stringify(duplicateRegionId))).toThrow(
      'region_id「text-1」が重複',
    )
  })

  it('rejects duplicate asset names when loading and saving', () => {
    const value = document()
    value.assets = [
      {
        id: 'coin-1',
        name: 'coin',
        sourceImageId: 'card-1',
        sourceRect: { x: 0, y: 0, width: 10, height: 10 },
        imagePath: 'assets/coin-1.png',
        scale: 1,
        baselineOffset: 0,
        inlinePadding: 0,
      },
      {
        id: 'coin-2',
        name: 'coin',
        sourceImageId: 'card-1',
        sourceRect: { x: 0, y: 0, width: 10, height: 10 },
        imagePath: 'assets/coin-2.png',
        scale: 1,
        baselineOffset: 0,
        inlinePadding: 0,
      },
    ]

    expect(() => parseFolderProject(JSON.stringify(value))).toThrow(
      'アセット名「coin」が重複',
    )
    expect(() => serializeFolderProject(value)).toThrow(
      'アセット名「coin」が重複',
    )
  })

  it('rejects excessive project collection and string sizes', () => {
    const tooManyCards = document()
    tooManyCards.cards = Array.from(
      { length: 10_001 },
      (_, index) => ({ ...tooManyCards.cards[0]!, id: `card-${index}` }),
    )
    expect(() => parseFolderProject(JSON.stringify(tooManyCards))).toThrow(
      'カードは10000件以下',
    )

    const longString = document()
    longString.name = 'x'.repeat(1_000_001)
    expect(() => parseFolderProject(JSON.stringify(longString))).toThrow(
      '1000000文字以下',
    )
  })

  it('fills optional region fields with current defaults', () => {
    const value = document()
    value.cards[0]!.regions = [
      {
        id: 'region-1',
        x: 1,
        y: 2,
        width: 30,
        height: 10,
      },
    ] as never
    const region = parseFolderProject(JSON.stringify(value)).cards[0]!.regions[0]!
    expect(region).toMatchObject({
      regionId: 'region_1',
      displayName: '領域 1',
      backgroundMode: 'auto',
      autoMaskPreset: 'auto',
      removeColorOutliers: true,
      textAlign: 'left',
      verticalAlign: 'middle',
      autoFitFontSize: true,
      fontId: null,
      textStyles: [],
      inlineAssetStyles: [],
      translationStatus: 'untranslated',
    })
  })

  it('preserves a disabled automatic font-size adjustment', () => {
    const value = document()
    value.cards[0]!.regions = [{
      id: 'region-1',
      autoFitFontSize: false,
    }] as never

    const region = parseFolderProject(JSON.stringify(value)).cards[0]!.regions[0]!
    expect(region.autoFitFontSize).toBe(false)
  })

  it('migrates missing translation status from the translated text', () => {
    const value = document()
    value.cards[0]!.regions = [
      { id: 'empty', translatedText: '' },
      { id: 'translated', translatedText: '訳文' },
    ] as never

    const regions = parseFolderProject(JSON.stringify(value)).cards[0]!.regions
    expect(regions.map(region => region.translationStatus)).toEqual([
      'untranslated',
      'draft',
    ])
  })

  it('preserves asset geometry and font references without font data', () => {
    const value = document()
    value.assets = [
      {
        id: 'coin-id',
        name: 'coin',
        sourceImageId: 'card-1',
        sourceRect: { x: 2, y: 3, width: 12, height: 10 },
        imagePath: 'assets/coin-id.png',
        scale: 1.2,
        baselineOffset: -0.1,
        inlinePadding: 0.2,
      },
    ]
    value.fonts = [
      {
        id: 'font-id',
        displayName: 'My Font',
        familyName: 'HappyLocaleUserFont_font_id',
        fileName: 'my-font.woff2',
        source: 'user',
      },
    ]
    const serialized = serializeFolderProject(value)
    const parsed = parseFolderProject(serialized)
    expect(parsed.assets).toEqual(value.assets)
    expect(parsed.fonts).toEqual(value.fonts)
    expect(serialized).not.toContain('ArrayBuffer')
    expect(serialized).not.toContain('data:font')
  })

  it('preserves per-occurrence inline asset settings', () => {
    const value = document()
    value.cards[0]!.regions = [{
      id: 'region-1',
      translatedText: '[icon:coin]',
      inlineAssetStyles: [{
        start: 0,
        end: 11,
        assetId: 'coin-id',
        scale: 1.25,
        baselineOffset: -0.15,
        inlinePadding: 0.2,
      }],
    }] as never

    expect(
      parseFolderProject(serializeFolderProject(value))
        .cards[0]!
        .regions[0]!
        .inlineAssetStyles,
    ).toEqual(value.cards[0]!.regions[0]!.inlineAssetStyles)
  })

  it('preserves references to installed system fonts', () => {
    const value = document()
    value.fonts = [{
      id: 'system-font',
      displayName: 'Hiragino Sans W6',
      familyName: 'HappyLocaleSystemFont_system_font',
      fileName: '',
      source: 'system',
      postscriptName: 'HiraginoSans-W6',
      style: 'W6',
    }]

    expect(parseFolderProject(serializeFolderProject(value)).fonts).toEqual(
      value.fonts,
    )
  })

  it('preserves project OCR dictionary entries', () => {
    const value = document()
    value.ocrDictionary = [
      { id: 'wound', source: 'Wounb', replacement: 'Wound' },
    ]

    expect(
      parseFolderProject(serializeFolderProject(value)).ocrDictionary,
    ).toEqual(value.ocrDictionary)
  })

  it('preserves regions that draw text without modifying the background', () => {
    const value = document()
    value.cards[0]!.regions = [
      {
        id: 'label',
        x: 1,
        y: 2,
        width: 30,
        height: 10,
        backgroundMode: 'none',
      },
    ] as never

    const parsed = parseFolderProject(serializeFolderProject(value))

    expect(parsed.cards[0]!.regions[0]?.backgroundMode).toBe('none')
  })

  it('preserves eraser strokes and treats legacy strokes as paint', () => {
    const value = document()
    value.cards[0]!.regions = [
      {
        id: 'masked',
        x: 1,
        y: 2,
        width: 30,
        height: 10,
        manualMaskStrokes: [
          { brushSize: 8, points: [{ x: 4, y: 5 }] },
          {
            brushSize: 4,
            mode: 'erase',
            points: [{ x: 6, y: 5 }],
          },
        ],
      },
    ] as never

    const strokes = parseFolderProject(
      serializeFolderProject(value),
    ).cards[0]!.regions[0]!.manualMaskStrokes

    expect(strokes[0]?.mode).toBeUndefined()
    expect(strokes[1]?.mode).toBe('erase')
  })
})
