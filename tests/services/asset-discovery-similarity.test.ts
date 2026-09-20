import type { AssetFingerprint } from '~/utils/asset-matching'
import { describe, expect, it } from 'vitest'
import { discoverySimilarity, proposeIconGroups } from '~/services/asset-discovery/group'
import { assetSimilarity } from '~/utils/asset-matching'

function pattern({ dx = 0, dy = 0, missing = false, partial = false, style = 'diagonal', tint = false }: {
  dx?: number
  dy?: number
  missing?: boolean
  partial?: boolean
  style?: 'diagonal' | 'vertical' | 'mirror' | 'flat'
  tint?: boolean
} = {}): AssetFingerprint {
  const pixels = new Float32Array(24 * 24 * 4)
  for (let y = 3; y < 21; y++) {
    for (let x = 3; x < 21; x++) {
      if ((missing && x >= 15 && y >= 13) || (partial && x >= 12))
        continue
      const inside = style === 'vertical' ? x >= 10 && x < 14 : style === 'mirror' ? Math.abs(x + y - 23) < 3 : Math.abs(x - y) < 3
      const value = style === 'flat' ? 0.45 : inside ? 0.85 : 0.2
      const color = tint ? [value * 0.2, value * 0.5, value] : [value, value * 0.7, value * 0.3]
      pixels.set([...color, 1], ((y + dy) * 24 + x + dx) * 4)
    }
  }
  return { pixels, aspect: 1 }
}

describe('discovery pattern comparison', () => {
  it('matches a shifted detailed icon with incomplete background removal without changing its pixels', () => {
    const a = pattern()
    const b = pattern({ dx: 2, dy: -2, missing: true })
    const original = b.pixels.slice()
    expect(assetSimilarity(a, b)).toBeLessThan(0.9)
    expect(discoverySimilarity(a, b)).toBeGreaterThanOrEqual(0.9)
    expect(discoverySimilarity(a, b)).toBeCloseTo(discoverySimilarity(b, a), 6)
    expect(b.pixels).toEqual(original)
    expect(proposeIconGroups([{ id: 'a', fingerprint: a }, { id: 'b', fingerprint: b }]).groups.map(g => g.memberIds))
      .toEqual([['a', 'b']])
  })

  it.each(['vertical', 'mirror'] as const)('distinguishes an identical silhouette with a different internal %s symbol', (style) => {
    const a = pattern()
    const b = pattern({ style })
    expect(assetSimilarity(a, b)).toBeGreaterThan(0.9)
    expect(discoverySimilarity(a, b)).toBeLessThan(0.9)
    expect(proposeIconGroups([{ id: 'a', fingerprint: a }, { id: 'b', fingerprint: b }]).groups).toHaveLength(2)
  })

  it('rejects color variants, matching fragments, flat fills and incompatible aspect ratios', () => {
    const a = pattern()
    expect(discoverySimilarity(a, pattern({ tint: true }))).toBeLessThan(0.9)
    expect(discoverySimilarity(a, pattern({ partial: true }))).toBe(0)
    expect(discoverySimilarity(a, pattern({ style: 'flat' }))).toBe(0)
    expect(discoverySimilarity(a, { ...pattern(), aspect: 0.5 })).toBe(0)
    expect(discoverySimilarity(a, pattern())).toBeCloseTo(1)
  })

  it('does not retain prepared pixels across separate proposals', () => {
    const a = pattern()
    const b = pattern()
    expect(discoverySimilarity(a, b)).toBeCloseTo(1)
    b.pixels.set(pattern({ style: 'vertical' }).pixels)
    expect(discoverySimilarity(a, b)).toBeLessThan(0.9)
  })

  it('keeps muted hue variants separate even with small absolute RGB differences', () => {
    const tint = (color: number[]) => {
      const result = pattern({ style: 'flat' })
      for (let p = 0; p < result.pixels.length; p += 4) {
        if (result.pixels[p + 3])
          result.pixels.set(color, p)
      }
      return result
    }
    const green = tint([0.4, 0.5, 0.4])
    const purple = tint([0.5, 0.4, 0.5])
    expect(assetSimilarity(green, purple)).toBeGreaterThan(0.9)
    expect(discoverySimilarity(green, purple)).toBe(0)
    expect(discoverySimilarity(green, tint([0.36, 0.45, 0.36]))).toBeGreaterThan(0.9)
  })

  it.each(['length', 'aspect', 'nan', 'alpha', 'premultiplied'] as const)('rejects malformed %s fingerprints instead of producing NaN matches', (kind) => {
    const a = pattern()
    const b = pattern()
    if (kind === 'length')
      b.pixels = new Float32Array(4)
    if (kind === 'aspect')
      b.aspect = Infinity
    if (kind === 'nan')
      b.pixels[0] = Number.NaN
    if (kind === 'alpha')
      b.pixels[3] = -1
    if (kind === 'premultiplied')
      b.pixels[0] = 1
    expect(discoverySimilarity(a, b)).toBe(0)
    expect(discoverySimilarity(b, a)).toBe(0)
  })
})
