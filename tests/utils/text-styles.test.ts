import { describe, expect, it } from 'vitest'
import { applyTextStyle, reconcileTextStyles } from '~/utils/text-styles'

describe('partial text styles', () => {
  it('combines color and font changes on the same selection', () => {
    const colored = applyTextStyle([], 5, 1, 4, { textColor: '#ff0000' })
    const styled = applyTextStyle(colored, 5, 2, 3, { fontId: 'font-1' })

    expect(styled).toEqual([
      { start: 1, end: 2, textColor: '#ff0000' },
      { start: 2, end: 3, textColor: '#ff0000', fontId: 'font-1' },
      { start: 3, end: 4, textColor: '#ff0000' },
    ])
  })

  it('removes styles only from the selected range', () => {
    expect(
      applyTextStyle(
        [{ start: 0, end: 4, textColor: '#ff0000' }],
        4,
        1,
        3,
        null,
      ),
    ).toEqual([
      { start: 0, end: 1, textColor: '#ff0000' },
      { start: 3, end: 4, textColor: '#ff0000' },
    ])
  })

  it('moves styles after edited text and drops styles inside the edit', () => {
    expect(
      reconcileTextStyles(
        'ABCDE',
        'ABxyDE',
        [
          { start: 1, end: 3, textColor: '#ff0000' },
          { start: 3, end: 5, fontId: 'font-1' },
        ],
      ),
    ).toEqual([
      { start: 1, end: 2, textColor: '#ff0000' },
      { start: 4, end: 6, fontId: 'font-1' },
    ])
  })
})
