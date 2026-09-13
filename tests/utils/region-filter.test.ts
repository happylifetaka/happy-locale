import type { TextRegion, TranslationStatus } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { filterProjectRegions, filterRegions } from '~/utils/region-filter'

function region(
  id: string,
  originalText: string,
  translatedText: string,
  translationStatus: TranslationStatus,
): TextRegion {
  return {
    id,
    regionId: `effect_${id}`,
    displayName: `効果 ${id}`,
    originalText,
    translatedText,
    translationStatus,
  } as TextRegion
}

const regions = [
  region('draw', 'Draw a card.', 'カードを引く。', 'reviewed'),
  region('heal', 'Heal 2 damage.', '2ダメージ回復する。', 'draft'),
  region('empty', 'Gain gold.', '', 'untranslated'),
]

describe('region filter', () => {
  it('combines role, status and text filters and distinguishes unassigned regions', () => {
    const classified: TextRegion[] = [
      { ...regions[0]!, role: 'effect' },
      { ...regions[1]!, role: 'effect' },
      regions[2]!,
    ]
    expect(filterRegions(classified, 'damage', 'draft', 'effect').map(item => item.id)).toEqual(['heal'])
    expect(filterRegions(classified, '', 'all', 'name')).toEqual([])
    expect(filterRegions(classified, '', 'all', '').map(item => item.id)).toEqual(['empty'])
  })

  it('searches names, ids, source text, and translated text', () => {
    expect(filterRegions(regions, 'DRAW', 'all').map(item => item.id)).toEqual([
      'draw',
    ])
    expect(filterRegions(regions, '回復', 'all').map(item => item.id)).toEqual([
      'heal',
    ])
    expect(filterRegions(regions, 'effect_empty', 'all').map(item => item.id)).toEqual([
      'empty',
    ])
  })

  it('combines text and status filters', () => {
    expect(filterRegions(regions, 'damage', 'draft').map(item => item.id)).toEqual([
      'heal',
    ])
    expect(filterRegions(regions, '', 'untranslated').map(item => item.id)).toEqual([
      'empty',
    ])
  })

  it('returns matching regions with their card identity', () => {
    expect(filterProjectRegions([
      { id: 'card-1', imageName: 'one.png', regions: [regions[0]!] },
      { id: 'card-2', imageName: 'two.png', regions: regions.slice(1) },
    ], '回復', 'draft')).toEqual([
      { cardId: 'card-2', cardName: 'two.png', region: regions[1] },
    ])
  })
})
