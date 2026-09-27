import type { RegionDraft } from '~/types/editor'

export function intersectionArea(a: RegionDraft, b: RegionDraft): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

export function validBounds(rect: RegionDraft): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
}

export function clipBounds(rect: RegionDraft, width: number, height: number): RegionDraft {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)))
  return { x, y, width: Math.max(0, Math.min(width, Math.ceil(rect.x + rect.width)) - x), height: Math.max(0, Math.min(height, Math.ceil(rect.y + rect.height)) - y) }
}
