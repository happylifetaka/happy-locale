import { expect, it } from 'vitest'
import { textDiff, visibleWhitespace } from '~/utils/text-diff'

it('highlights only the removed space after an icon', () => {
  expect(textDiff('Heal a Wounp. If it wasa [icon:wound] , you may take', 'Heal a Wounp. If it wasa [icon:wound], you may take')).toEqual([
    { kind: 'equal', text: 'Heal a Wounp. If it wasa [icon:wound]' },
    { kind: 'delete', text: ' ' },
    { kind: 'equal', text: ', you may take' },
  ])
  expect(visibleWhitespace(' \t\n')).toBe('␠⇥↵')
})

it.each([
  ['a ,then b !', 'a, then b!'],
  ['WounD', 'Wound'],
  ['', 'new'],
  ['old', ''],
  ['same', 'same'],
  ['a☀️b', 'a🌞b'],
])('preserves both texts while highlighting separate changes: %s → %s', (original, corrected) => {
  const parts = textDiff(original, corrected)
  expect(parts.filter(part => part.kind !== 'insert').map(part => part.text).join('')).toBe(original)
  expect(parts.filter(part => part.kind !== 'delete').map(part => part.text).join('')).toBe(corrected)
  if (original === 'a ,then b !')
    expect(parts.filter(part => part.kind !== 'equal').map(part => part.text)).toEqual([' ', ' ', ' '])
})
