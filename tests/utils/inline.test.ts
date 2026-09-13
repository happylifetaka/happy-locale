import type { ImageAsset } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { fitInlineContent, parseInlineContent } from '~/utils/canvas/inline'

const asset: ImageAsset = {
  id: 'coin-id',
  name: 'coin',
  sourceImageId: 'card-id',
  sourceRect: { x: 0, y: 0, width: 20, height: 10 },
  imagePath: 'assets/coin-id.png',
  scale: 1,
  baselineOffset: 0,
  inlinePadding: 0,
}

const context = {
  font: '',
  measureText: (text: string) => ({ width: [...text].length * 10 }),
} as Pick<CanvasRenderingContext2D, 'measureText'> & { font: string }

describe('inline content', () => {
  it('parses known asset tokens and preserves unknown tokens', () => {
    expect(
      parseInlineContent('得る[icon:coin]。[icon:missing]', [asset]),
    ).toEqual([
      { type: 'text', text: '得る', start: 0 },
      { type: 'asset', assetId: 'coin-id', start: 2, end: 13 },
      { type: 'text', text: '。[icon:missing]', start: 13 },
    ])
  })

  it('applies settings to one asset occurrence without changing its default', () => {
    const layout = fitInlineContent(
      context,
      parseInlineContent('A[icon:coin]B', [asset], [{
        start: 1,
        end: 12,
        assetId: 'coin-id',
        scale: 1.5,
        baselineOffset: -0.2,
        inlinePadding: 0.1,
      }]),
      [asset],
      100,
      40,
      10,
      [],
      'left',
    )

    expect(layout.runs[1]).toMatchObject({
      type: 'asset',
      assetId: 'coin-id',
      width: 30,
      height: 15,
      x: 11,
      y: -4.5,
    })
    expect(asset).toMatchObject({
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    })
  })

  it('creates separate runs for partial text styles', () => {
    const layout = fitInlineContent(
      context,
      parseInlineContent('ABC', []),
      [],
      100,
      30,
      10,
      [],
      'left',
      8,
      'sans-serif',
      [{ start: 1, end: 2, textColor: '#ff0000', fontId: 'special' }],
      new Map([['special', 'Special Font']]),
    )

    expect(layout.runs).toMatchObject([
      { type: 'text', text: 'A', fontFamily: 'sans-serif' },
      {
        type: 'text',
        text: 'B',
        textColor: '#ff0000',
        fontFamily: 'Special Font',
      },
      { type: 'text', text: 'C', fontFamily: 'sans-serif' },
    ])
  })

  it('lays out text and an aspect-ratio-preserving asset together', () => {
    const layout = fitInlineContent(
      context,
      parseInlineContent('A[icon:coin]B', [asset]),
      [asset],
      100,
      30,
      10,
      [],
      'left',
    )
    expect(layout.fits).toBe(true)
    expect(layout.runs).toHaveLength(3)
    expect(layout.runs[1]).toMatchObject({
      type: 'asset',
      assetId: 'coin-id',
      width: 20,
      height: 10,
      x: 10,
      y: 0,
    })
  })

  it.each([0.5, 1, 1.5])('centers an asset scaled to %s on each text line, excluding line spacing', (scale) => {
    const scaled = { ...asset, scale }
    const layout = fitInlineContent(
      context,
      parseInlineContent('A[icon:coin]\nB[icon:coin]', [scaled]),
      [scaled],
      100,
      60,
      10,
      [],
      'left',
    )
    const icons = layout.runs.filter(run => run.type === 'asset')
    expect(icons).toHaveLength(2)
    expect(icons[0]!.y + icons[0]!.height / 2).toBe(5)
    expect(icons[1]!.y + icons[1]!.height / 2).toBe(layout.lineHeight + 5)
  })

  it('adds symmetric inline padding without stretching the asset image', () => {
    const padded = { ...asset, inlinePadding: 0.25 }
    const layout = fitInlineContent(
      context,
      parseInlineContent('A[icon:coin]B', [padded]),
      [padded],
      100,
      30,
      10,
      [],
      'left',
    )
    expect(layout.runs[1]).toMatchObject({
      type: 'asset',
      width: 20,
      x: 12.5,
    })
    expect(layout.runs[2]).toMatchObject({
      type: 'text',
      x: 35,
    })
  })

  it('does not discard an asset that is too wide at the minimum size', () => {
    const wide = {
      ...asset,
      sourceRect: { x: 0, y: 0, width: 200, height: 10 },
    }
    const layout = fitInlineContent(
      context,
      parseInlineContent('[icon:coin]', [wide]),
      [wide],
      20,
      30,
      10,
      [],
      'left',
      8,
    )
    expect(layout.fits).toBe(false)
    expect(layout.runs).toEqual([])
  })
})
