import type { ResizeHandle } from './geometry'
import { expect, it } from 'vitest'
import { changedBounds, imagePoint, lastBoundsAtPoint, normalizedBounds, pointInsideBounds, relativePoint, resizeHandleAtPoint, roundedBounds } from './geometry'

it.each([25, 50, 75, 100, 150, 200])('converts CSS coordinates at %s%% zoom to the same bounded image coordinates', (zoom) => {
  const scale = zoom / 100
  const bounds = { left: 27, top: 83, width: 600 * scale, height: 900 * scale }
  const size = { width: 600, height: 900 }
  expect(imagePoint({ clientX: 27 + 123 * scale, clientY: 83 + 456 * scale }, bounds, size)).toEqual({ x: 123, y: 456 })
  expect(imagePoint({ clientX: -100, clientY: 2000 }, bounds, size)).toEqual({ x: 0, y: 900 })
})

it('uses region-relative coordinates, inclusive edges and last-painted hit priority', () => {
  const first = { id: 'first', x: 10, y: 20, width: 100, height: 80 }
  const second = { ...first, id: 'second' }
  expect(relativePoint({ x: 15, y: 42 }, first)).toEqual({ x: 5, y: 22 })
  expect(relativePoint({ x: 0, y: 110 }, first)).toEqual({ x: 0, y: 80 })
  expect(pointInsideBounds({ x: 110, y: 100 }, first)).toBe(true)
  expect(pointInsideBounds({ x: 111, y: 100 }, first)).toBe(false)
  expect(lastBoundsAtPoint([first, second], { x: 50, y: 50 })).toBe(second)
  expect(lastBoundsAtPoint([first, second], { x: 0, y: 0 })).toBeUndefined()
})

it.each([25, 50, 100, 200])('uses an 8 CSS-pixel handle tolerance at %s%%, with edge handles only for candidates', (zoom) => {
  const region = { x: 50, y: 50, width: 200, height: 200 }
  const tolerance = 8 / (zoom / 100)
  expect(resizeHandleAtPoint({ x: 50 - tolerance, y: 50 }, region, zoom)).toBe('nw')
  expect(resizeHandleAtPoint({ x: 50 - tolerance - 0.01, y: 50 }, region, zoom)).toBeNull()
  expect(resizeHandleAtPoint({ x: 150, y: 50 }, region, zoom)).toBeNull()
  expect(resizeHandleAtPoint({ x: 150, y: 50 }, region, zoom, true)).toBe('n')
  expect(resizeHandleAtPoint({ x: 150, y: 150 }, region, zoom, true)).toBeNull()
})

it('keeps existing corner priority when tiny bounds have overlapping hit tolerances', () => {
  const region = { x: 50, y: 50, width: 5, height: 5 }
  expect(resizeHandleAtPoint({ x: 53, y: 53 }, region, 100)).toBe('nw')
  expect(resizeHandleAtPoint({ x: 53, y: 53 }, region, 100, true)).toBe('nw')
})

it('rounds two-point rectangles independently of drag direction and leaves subpixel moves until commit', () => {
  const start = { x: 90.2, y: 82.1 }
  const end = { x: 10.1, y: 20.4 }
  expect(normalizedBounds(start, end)).toEqual({ x: 10, y: 20, width: 80, height: 62 })
  expect(normalizedBounds(end, start)).toEqual(normalizedBounds(start, end))
  const original = { x: 10, y: 20, width: 40, height: 30 }
  const result = changedBounds({ kind: 'move', start: { x: 0, y: 0 }, original }, { x: 0.4, y: 0.6 }, { width: 200, height: 200 })
  expect(result).toEqual({ ...original, x: 10.4, y: 20.6 })
  expect(roundedBounds(result)).toEqual({ ...original, x: 10, y: 21 })
  expect(original).toEqual({ x: 10, y: 20, width: 40, height: 30 })
})

it('clamps movement in image or exclusion-local space without changing its size', () => {
  const interaction = { kind: 'move' as const, start: { x: 20, y: 30 }, original: { x: 10, y: 20, width: 40, height: 30 } }
  expect(changedBounds(interaction, { x: 1000, y: -1000 }, { width: 200, height: 150 })).toEqual({ x: 160, y: 0, width: 40, height: 30 })
  expect(changedBounds(interaction, { x: 1000, y: 1000 }, { width: 60, height: 50 })).toEqual({ x: 20, y: 20, width: 40, height: 30 })
})

it.each<[ResizeHandle, number[]]>([
  ['nw', [15, 27, 35, 23]],
  ['n', [10, 27, 40, 23]],
  ['ne', [10, 27, 45, 23]],
  ['e', [10, 20, 45, 30]],
  ['se', [10, 20, 45, 37]],
  ['s', [10, 20, 40, 37]],
  ['sw', [15, 20, 35, 37]],
  ['w', [15, 20, 35, 30]],
])('resizes %s without moving its opposite sides', (handle, expected) => {
  const bounds = changedBounds({ kind: 'resize', handle, start: { x: 0, y: 0 }, original: { x: 10, y: 20, width: 40, height: 30 } }, { x: 5, y: 7 }, { width: 200, height: 150 })
  expect([bounds.x, bounds.y, bounds.width, bounds.height]).toEqual(expected)
})

it('limits resizing to a 5-pixel minimum and to the containing region or image', () => {
  const original = { x: 10, y: 20, width: 40, height: 30 }
  const interaction = { kind: 'resize' as const, start: { x: 0, y: 0 }, original }
  const size = { width: 200, height: 150 }
  expect(changedBounds({ ...interaction, handle: 'nw' }, { x: 1000, y: 1000 }, size)).toEqual({ x: 45, y: 45, width: 5, height: 5 })
  expect(changedBounds({ ...interaction, handle: 'se' }, { x: -1000, y: -1000 }, size)).toEqual({ x: 10, y: 20, width: 5, height: 5 })
  expect(changedBounds({ ...interaction, handle: 'nw' }, { x: -1000, y: -1000 }, size)).toEqual({ x: 0, y: 0, width: 50, height: 50 })
  expect(changedBounds({ ...interaction, handle: 'se' }, { x: 1000, y: 1000 }, size)).toEqual({ x: 10, y: 20, width: 190, height: 130 })
})
