import type { FolderProjectCard } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINT_SETTINGS, layoutPrintAreas } from '~/services/print-layout'

function card(id: string, width = 300, height = 150): FolderProjectCard {
  return {
    id,
    imagePath: `images/${id}.png`,
    imageName: `${id}.png`,
    imageWidth: 900,
    imageHeight: 1200,
    regions: [],
    printArea: { x: 0, y: 0, width, height },
    sourceDpi: { x: 300, y: 300 },
  }
}

describe('a4 print layout', () => {
  it('places cards in three columns at source physical size', () => {
    const result = layoutPrintAreas(
      [card('one'), card('two'), card('three'), card('four')],
      DEFAULT_PRINT_SETTINGS,
    )

    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.items).toHaveLength(4)
    expect(result.pages[0]!.items[0]!.widthMm).toBeCloseTo(25.4)
    expect(result.pages[0]!.items[3]!.yMm).toBeGreaterThan(
      result.pages[0]!.items[0]!.yMm,
    )
    expect(result.pages[0]!.items[3]!.xMm).toBe(DEFAULT_PRINT_SETTINGS.marginMm)
  })

  it('left-aligns an incomplete final row', () => {
    const result = layoutPrintAreas(
      [card('one'), card('two'), card('three'), card('four'), card('five')],
      { ...DEFAULT_PRINT_SETTINGS, marginMm: 9.75, gapMm: 2 },
    )
    const [, , , fourth, fifth] = result.pages[0]!.items

    expect(fourth!.xMm).toBe(9.75)
    expect(fifth!.xMm).toBeCloseTo(fourth!.xMm + fourth!.widthMm + 2)
  })

  it('moves a whole row to the next page', () => {
    const tallCards = Array.from({ length: 10 }, (_, index) =>
      card(`card-${index}`, 300, 900))
    const result = layoutPrintAreas(tallCards, DEFAULT_PRINT_SETTINGS)

    expect(result.pages.length).toBeGreaterThan(1)
    expect(result.pages.every(page => page.items.length % 3 === 0
      || page === result.pages.at(-1))).toBe(true)
  })

  it('reports missing metadata and ranges that do not fit', () => {
    const withoutArea = { ...card('area'), printArea: null }
    const withoutDpi = { ...card('dpi'), sourceDpi: null }
    const tooWide = card('wide', 3000)
    const result = layoutPrintAreas(
      [withoutArea, withoutDpi, tooWide],
      DEFAULT_PRINT_SETTINGS,
    )

    expect(result.missingAreaCardIds).toEqual(['area'])
    expect(result.missingDpiCardIds).toEqual(['dpi'])
    expect(result.overflowingCardIds).toEqual(['wide'])
    expect(result.overflowingRows).toHaveLength(1)
  })

  it('packs unequal widths with the exact requested gap and centers the row', () => {
    const cards = [
      card('one', 744),
      card('two', 742),
      card('three', 743),
    ].map(item => ({ ...item, sourceDpi: { x: 297.6, y: 297.6 } }))
    const result = layoutPrintAreas(cards, {
      ...DEFAULT_PRINT_SETTINGS,
      marginMm: 9.76,
      gapMm: 0,
    })
    const items = result.pages[0]!.items

    expect(result.overflowingCardIds).toEqual([])
    expect(items[1]!.xMm).toBeCloseTo(
      items[0]!.xMm + items[0]!.widthMm,
    )
    expect(items[2]!.xMm).toBeCloseTo(
      items[1]!.xMm + items[1]!.widthMm,
    )
    expect(items[0]!.xMm).toBeCloseTo(
      210 - items[2]!.xMm - items[2]!.widthMm,
    )
  })

  it('reports the width calculation and maximum symmetric margin', () => {
    const cards = [
      card('one', 744),
      card('two', 742),
      card('three', 743),
    ].map(item => ({ ...item, sourceDpi: { x: 297.6, y: 297.6 } }))
    const result = layoutPrintAreas(cards, {
      ...DEFAULT_PRINT_SETTINGS,
      marginMm: 9.88,
      gapMm: 0,
    })
    const overflow = result.overflowingRows[0]!

    expect(result.overflowingCardIds).toEqual(['one', 'two', 'three'])
    expect(overflow.sealWidthMm).toBeCloseTo(190.24395)
    expect(overflow.gapWidthMm).toBe(0)
    expect(overflow.availableWidthMm).toBeCloseTo(190.24)
    expect(overflow.maximumMarginMm).toBeCloseTo(9.87802)
    expect(overflow.overflowMm).toBeCloseTo(0.00395)
  })
})
