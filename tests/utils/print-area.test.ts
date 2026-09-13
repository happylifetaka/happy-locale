import { describe, expect, it } from 'vitest'
import {
  printAreaPointerCompletion,
  updatePrintAreaNumericField,
  usablePrintArea,
} from '~/utils/print-area'

describe('print area pointer interaction', () => {
  it('keeps a zero-sized first click active for click-to-click selection', () => {
    const start = { x: 10, y: 20, width: 0, height: 0 }

    expect(printAreaPointerCompletion(start, start)).toBe('continue')
  })

  it('commits a large enough drag or second-click range', () => {
    const start = { x: 10, y: 20, width: 0, height: 0 }
    const range = { x: 10, y: 20, width: 120, height: 60 }

    expect(usablePrintArea(range)).toBe(true)
    expect(printAreaPointerCompletion(start, range)).toBe('commit')
  })

  it('cancels an existing-range interaction when no draft is available', () => {
    const area = { x: 10, y: 20, width: 120, height: 60 }

    expect(printAreaPointerCompletion(area, area)).toBe('commit')
    expect(printAreaPointerCompletion(area, null)).toBe('cancel')
  })

  it('updates numeric print-area fields in whole pixels', () => {
    const area = { x: 10, y: 20, width: 120, height: 60 }

    expect(updatePrintAreaNumericField(area, 'x', 12.6, 200, 150)).toEqual({
      ...area,
      x: 13,
    })
    expect(updatePrintAreaNumericField(area, 'width', 80.4, 200, 150)).toEqual({
      ...area,
      width: 80,
    })
  })

  it('keeps numeric print-area edits inside the image', () => {
    const area = { x: 10, y: 20, width: 120, height: 60 }

    expect(updatePrintAreaNumericField(area, 'x', 100, 200, 150)?.x).toBe(80)
    expect(updatePrintAreaNumericField(area, 'y', -5, 200, 150)?.y).toBe(0)
    expect(updatePrintAreaNumericField(area, 'width', 500, 200, 150)?.width).toBe(190)
    expect(updatePrintAreaNumericField(area, 'height', 0, 200, 150)?.height).toBe(5)
  })

  it('ignores an invalid numeric print-area edit', () => {
    const area = { x: 10, y: 20, width: 120, height: 60 }

    expect(updatePrintAreaNumericField(area, 'x', Number.NaN, 200, 150)).toBeNull()
  })
})
