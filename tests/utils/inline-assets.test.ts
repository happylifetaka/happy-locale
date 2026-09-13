import type { InlineAssetStyleRange } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import {
  findInlineAssetOccurrences,
  reconcileInlineAssetStyles,
  renameInlineAssetStyles,
  updateInlineAssetStyle,
} from '~/utils/inline-assets'

const assets = [
  { id: 'coin-id', name: 'coin' },
  { id: 'heart-id', name: 'heart' },
]

describe('inline asset occurrence styles', () => {
  it('identifies repeated registered tokens separately', () => {
    expect(findInlineAssetOccurrences(
      '[icon:coin] + [icon:coin] + [icon:missing]',
      assets,
    )).toEqual([
      {
        start: 0,
        end: 11,
        assetId: 'coin-id',
        assetName: 'coin',
        occurrence: 0,
      },
      {
        start: 14,
        end: 25,
        assetId: 'coin-id',
        assetName: 'coin',
        occurrence: 1,
      },
    ])
  })

  it('updates and resets only the selected occurrence', () => {
    const occurrences = findInlineAssetOccurrences(
      '[icon:coin] [icon:coin]',
      assets,
    )
    const first = updateInlineAssetStyle([], occurrences[0]!, {
      scale: 1.4,
    })
    const both = updateInlineAssetStyle(first, occurrences[1]!, {
      baselineOffset: -0.2,
    })

    expect(both).toEqual([
      { start: 0, end: 11, assetId: 'coin-id', scale: 1.4 },
      {
        start: 12,
        end: 23,
        assetId: 'coin-id',
        baselineOffset: -0.2,
      },
    ])
    expect(updateInlineAssetStyle(both, occurrences[0]!, null)).toEqual([
      {
        start: 12,
        end: 23,
        assetId: 'coin-id',
        baselineOffset: -0.2,
      },
    ])
  })

  it('moves styles with the same named occurrence after text edits', () => {
    const styles: InlineAssetStyleRange[] = [{
      start: 14,
      end: 25,
      assetId: 'coin-id',
      scale: 1.3,
    }]

    expect(reconcileInlineAssetStyles(
      '[icon:coin] + [icon:coin]',
      '追加 [icon:coin] / [icon:coin]。',
      styles,
    )).toEqual([{
      start: 17,
      end: 28,
      assetId: 'coin-id',
      scale: 1.3,
    }])
  })

  it('drops a style when its token is removed', () => {
    expect(reconcileInlineAssetStyles(
      'A [icon:coin]',
      'A',
      [{ start: 2, end: 13, assetId: 'coin-id', scale: 1.2 }],
    )).toEqual([])
  })

  it('preserves the target asset style through an asset rename', () => {
    expect(renameInlineAssetStyles(
      '[icon:heart] [icon:coin]',
      '[icon:heart] [icon:gold]',
      [
        { start: 0, end: 12, assetId: 'heart-id', scale: 0.8 },
        { start: 13, end: 24, assetId: 'coin-id', scale: 1.2 },
      ],
      'coin-id',
      'coin',
      'gold',
    )).toEqual([
      { start: 0, end: 12, assetId: 'heart-id', scale: 0.8 },
      { start: 13, end: 24, assetId: 'coin-id', scale: 1.2 },
    ])
  })

  it('does not confuse a renamed token with an existing unresolved name', () => {
    expect(renameInlineAssetStyles(
      '[icon:gold] [icon:coin]',
      '[icon:gold] [icon:gold]',
      [{ start: 12, end: 23, assetId: 'coin-id', scale: 1.2 }],
      'coin-id',
      'coin',
      'gold',
    )).toEqual([
      { start: 12, end: 23, assetId: 'coin-id', scale: 1.2 },
    ])
  })
})
