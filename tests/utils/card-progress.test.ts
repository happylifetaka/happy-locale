import { describe, expect, it } from 'vitest'
import { cardProgress, progressLabel } from '~/utils/card-progress'

function region(
  originalText = '',
  translatedText = '',
  translationStatus: 'untranslated' | 'draft' | 'reviewed' = 'untranslated',
) {
  return { originalText, translatedText, translationStatus }
}

describe('card progress', () => {
  it('counts non-blank source and translated text independently', () => {
    expect(cardProgress([
      region('Draw a card.', 'カードを1枚引く。', 'reviewed'),
      region('Gain 2 gold.', '  '),
      region(' ', '補足'),
    ])).toEqual({
      regions: 3,
      originalText: 2,
      translatedText: 2,
      reviewed: 1,
    })
  })

  it('formats empty and populated progress', () => {
    expect(progressLabel(0, 0)).toBe('—')
    expect(progressLabel(2, 3)).toBe('2/3')
  })
})
