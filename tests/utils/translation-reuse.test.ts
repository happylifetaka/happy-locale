import type { FolderProjectCard, GlossaryEntry, ImageAsset, TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { findReusableTranslations, translationConsistencyWarnings } from '~/utils/translation-reuse'

const region = { id: 'a', regionId: 'a', originalText: 'Gain +1 [icon:spell]', translatedText: 'current', translationStatus: 'draft' } as TextRegion
const assets = [{ name: 'spell' }, { name: 'wound' }] as ImageAsset[]
const card = (id: string, regions: TextRegion[]) => ({ id, imageName: `${id}.png`, regions }) as FolderProjectCard

describe('local translation reuse', () => {
  it('allows registered assets in translations when OCR source has no asset tokens', () => {
    expect(translationConsistencyWarnings('Heal a wound.', '[icon:wound]を癒す。', assets)).toEqual([])
    expect(translationConsistencyWarnings('Heal a wound.', '[icon:unknown]を癒す。', assets)).toEqual(['未登録のアイコン: unknown'])
    expect(translationConsistencyWarnings('Gain 2.', '3 [icon:spell]を得る。', assets)).toEqual([
      expect.stringContaining('原文にだけ「2」'),
    ])
  })

  it('matches whole source text, tolerates line wrapping, and keeps conflicting translations as choices', () => {
    const cards = [card('active', [region]), card('other', [
      { ...region, originalText: 'Gain\n+1 [icon:spell]', translatedText: '呪文+1', translationStatus: 'reviewed' },
      { ...region, id: 'b', translatedText: '魔法+1' },
      { ...region, id: 'c', originalText: 'Gain +2 [icon:spell]', translatedText: 'wrong number' },
      { ...region, id: 'd', originalText: 'gain +1 [icon:spell]', translatedText: 'different case' },
    ])]
    const glossary = [{ source: region.originalText, translation: '呪文+1' }, { source: 'Gain', translation: '得る' }] as GlossaryEntry[]
    const result = findReusableTranslations(region, 'active', cards, glossary)
    expect(result.map(item => item.translation)).toEqual(['呪文+1', '魔法+1'])
    expect(result[0]!.sources).toHaveLength(2)
    expect(result[0]!.sources[1]).toContain('確認済み')
    expect(result[1]!.sources[0]).toContain('下書き')
  })

  it('does not normalize whitespace inside asset names', () => {
    const target = { ...region, originalText: '[icon:a  b]' }
    expect(findReusableTranslations(target, 'active', [card('other', [{ ...region, originalText: '[icon:a b]' }])], [])).toEqual([])
  })

  it('checks icon multiplicity, unknown icons and signed numbers without treating icon names as numbers', () => {
    expect(translationConsistencyWarnings(region.originalText, '＋１ [icon:spell]を得る', assets)).toEqual([])
    expect(translationConsistencyWarnings(region.originalText, '-1 [icon:spell]', assets)).toHaveLength(1)
    expect(translationConsistencyWarnings(region.originalText, '+1 [icon:spell] [icon:spell]', assets)).toHaveLength(1)
    expect(translationConsistencyWarnings(region.originalText, '+1 [icon:unknown]', assets)).toHaveLength(2)
    expect(translationConsistencyWarnings('2 [icon:level3]', '2 [icon:level4]', [])).toHaveLength(2)
    expect(translationConsistencyWarnings(region.originalText, '', assets)).toEqual([])
  })
})
