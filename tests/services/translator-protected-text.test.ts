import { describe, expect, it } from 'vitest'
import { protectTranslationText } from '~/services/translator/protected-text'

describe('translation asset protection', () => {
  it('restores per-occurrence tokens after case and word order changes', () => {
    const protectedText = protectTranslationText('Spend 1 [icon:太陽] for 2 [icon:太陽] and [icon:$&].')
    expect(protectedText.text).toBe('Spend 1 zxqicon1qxz for 2 zxqicon2qxz and zxqicon3qxz.')
    expect(protectedText.restore('ZXQICON3QXZと2 zxqicon2qxzを、1 ZXQICON1QXZで得る。'))
      .toBe('[icon:$&]と2 [icon:太陽]を、1 [icon:太陽]で得る。')
  })
  it('avoids collisions with case-insensitive source identifiers', () => {
    const protectedText = protectTranslationText('ZXQICON1QXZ [icon:sun]')
    expect(protectedText.text).toBe('ZXQICON1QXZ zxqzxqicon1qxz')
    expect(protectedText.restore(protectedText.text)).toBe('ZXQICON1QXZ [icon:sun]')
  })
  it.each([
    '失われた',
    'zxqicon1qxz zxqicon1qxz',
    'zxqicon2qxz',
    'zxqicon1qxz zxqicon999qxz',
    'zxqicon1qxz [icon:extra]',
    'zxqicon1qxz [icon:broken',
    'azxqicon1qxz',
    'zxqicon1qxza',
    'zxq icon 1 qxz',
  ])('rejects missing, duplicate, unknown or damaged markers: %s', (output) => {
    expect(() => protectTranslationText('[icon:sun]').restore(output)).toThrow('復元できません')
  })
  it.each(['[icon:]', '[icon:sun', '[icon:a[b]]'])('rejects malformed input %s', (source) => {
    expect(() => protectTranslationText(source)).toThrow('復元できません')
  })
  it('leaves plain translations alone but rejects invented asset tags', () => {
    const protectedText = protectTranslationText('Draw 2 cards.')
    expect(protectedText.restore('カードを2枚引く。')).toBe('カードを2枚引く。')
    expect(() => protectedText.restore('[icon:sun]')).toThrow()
  })
})
