import { describe, expect, it } from 'vitest'
import { LocalOCRCorrector } from '../../app/services/ocr/local-corrector'

describe('local OCR corrector', () => {
  const corrector = new LocalOCRCorrector()
  it('preserves complete icon tokens including names and colon spacing', async () => {
    const result = await corrector.correct('Heal a W0UND or [icon:W0UND],then +1 [icon:spell].', [
      { id: 'spell', source: 'spell', replacement: 'magic' },
    ])
    expect(result.correctedText).toBe('Heal a WOUND or [icon:W0UND], then +1 [icon:spell].')
  })

  it('corrects unambiguous OCR character confusions in known words', async () => {
    const result = await corrector.correct(
      'Draw 2 card5.\nHeal a W0UND irnmediately.',
    )

    expect(result.correctedText).toBe(
      'Draw 2 cards.\nHeal a WOUND immediately.',
    )
    expect(result.changes).toHaveLength(3)
  })

  it('corrects b/d confusion and duplicated characters in wound', async () => {
    const result = await corrector.correct('Heal a Wounb or WounND.')

    expect(result.correctedText).toBe('Heal a Wound or Wound.')
    expect(result.changes).toHaveLength(2)
  })

  it('normalizes mixed capitalization in known words', async () => {
    const result = await corrector.correct('Heal a WounD.')

    expect(result.correctedText).toBe('Heal a Wound.')
    expect(result.changes).toHaveLength(1)
  })

  it('normalizes obvious punctuation spacing', async () => {
    const result = await corrector.correct('Draw a card ,then discard one.')

    expect(result.correctedText).toBe('Draw a card, then discard one.')
    expect(result.changes.some(change => change.reason === 'spacing')).toBe(true)
  })

  it('does not alter unknown names or ambiguous words', async () => {
    const result = await corrector.correct('Gain Zyr0n and 1 token.')

    expect(result.correctedText).toBe('Gain Zyr0n and 1 token.')
    expect(result.changes).toHaveLength(0)
  })

  it('applies project dictionary entries before built-in corrections', async () => {
    const result = await corrector.correct('Heal a Wounb.', [
      { id: 'wound', source: 'Wounb', replacement: 'WOUND' },
    ])

    expect(result.correctedText).toBe('Heal a WOUND.')
    expect(result.changes[0]?.reason).toBe('user-dictionary')
  })
})
