import { describe, expect, it } from 'vitest'
import { fitText, fitTextAroundExclusions, wrapText } from '~/utils/canvas/text'

function contextWithCharacterWidth(width: number) {
  return {
    font: '',
    measureText: (text: string) => ({ width: [...text].length * width }),
  } as Pick<CanvasRenderingContext2D, 'measureText'> & { font: string }
}

describe('canvas text layout', () => {
  it('wraps Japanese text without spaces', () => {
    const context = contextWithCharacterWidth(10)
    expect(wrapText(context, 'カードを2枚引く', 40)).toEqual([
      'カードを',
      '2枚引く',
    ])
  })

  it('reduces font size until all lines fit vertically', () => {
    const context = {
      font: '',
      measureText(text: string) {
        const size = Number.parseInt(this.font, 10)
        return { width: [...text].length * size }
      },
    } as Pick<CanvasRenderingContext2D, 'measureText'> & { font: string }
    const layout = fitText(context, '12345678', 40, 20, 20, 8)
    expect(layout.fontSize).toBeLessThan(20)
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(20)
  })

  it('flows text around a protected area', () => {
    const context = contextWithCharacterWidth(10)
    const layout = fitTextAroundExclusions(
      context,
      'abcdefghijklmnopqrst',
      100,
      52,
      10,
      [{ x: 60, y: 13, width: 40, height: 39 }],
    )

    expect(layout.fits).toBe(true)
    expect(layout.runs[0]).toMatchObject({ text: 'abcdefghij', width: 100 })
    expect(
      layout.runs
        .filter(run => run.y >= 13)
        .every(run => run.x + run.width <= 60),
    ).toBe(true)
  })
})
