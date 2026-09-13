import { describe, expect, it } from 'vitest'
import { statusForTranslation } from '~/utils/translation-status'

describe('translation status', () => {
  it('uses draft for text and untranslated for blank content', () => {
    expect(statusForTranslation('訳文')).toBe('draft')
    expect(statusForTranslation(' \n ')).toBe('untranslated')
  })
})
