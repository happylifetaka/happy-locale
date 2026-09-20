import type { AssetFingerprint } from '~/utils/asset-matching'
import { assetSimilarity } from '~/utils/asset-matching'

const sourceSize = 24
const size = 12

interface PreparedFingerprint {
  pixels: Float32Array
  color: number[]
  mass: number
  textured: boolean
}

function compatibleColor(a: number[], b: number[]): boolean {
  if (Math.max(...a.map((value, c) => Math.abs(value - b[c]!))) > 0.18)
    return false
  // 暗い色違いも絶対RGB差だけでは同一にしない。無彩色付近の不安定な色相は使わない。
  if (Math.min(Math.max(...a) - Math.min(...a), Math.max(...b) - Math.min(...b)) < 0.08)
    return true
  const meanA = a.reduce((sum, value) => sum + value, 0) / 3
  const meanB = b.reduce((sum, value) => sum + value, 0) / 3
  const ca = a.map(value => value - meanA)
  const cb = b.map(value => value - meanB)
  const cosine = ca.reduce((sum, value, c) => sum + value * cb[c]!, 0) / (Math.hypot(...ca) * Math.hypot(...cb))
  return cosine >= 0.8
}

function prepare(fingerprint: AssetFingerprint): PreparedFingerprint | null {
  if (fingerprint.pixels.length !== sourceSize * sourceSize * 4 || !Number.isFinite(fingerprint.aspect) || fingerprint.aspect <= 0)
    return null
  const pixels = new Float32Array(size * size * 4)
  for (let y = 0; y < sourceSize; y++) {
    for (let x = 0; x < sourceSize; x++) {
      const p = (y * sourceSize + x) * 4
      const q = (Math.floor(y / 2) * size + Math.floor(x / 2)) * 4
      const alpha = fingerprint.pixels[p + 3]!
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1.00001)
        return null
      for (let channel = 0; channel < 4; channel++) {
        const value = fingerprint.pixels[p + channel]!
        if (!Number.isFinite(value) || value < 0 || value > alpha + 0.00001)
          return null
        pixels[q + channel]! += value / 4
      }
    }
  }
  let mass = 0
  const sums = [0, 0, 0]
  const squares = [0, 0, 0]
  for (let p = 0; p < pixels.length; p += 4) {
    const alpha = pixels[p + 3]!
    mass += alpha
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[p + channel]!
      sums[channel]! += value
      squares[channel]! += alpha ? value * value / alpha : 0
      // 比較ではpremultiplied RGBではなく、共通の不透明度で重み付けした色を使う。
      pixels[p + channel] = alpha ? value / alpha : 0
    }
  }
  const color = sums.map(sum => mass ? sum / mass : 0)
  // 単色のRGB間の差を「模様」と判定しない。画面内の色の変動だけを測る。
  const variance = squares.reduce((sum, square, c) => sum + (mass ? square / mass - color[c]! ** 2 : 0), 0) / 3
  return { pixels, color, mass, textured: variance >= 0.0025 }
}

/** 最大9通りの平行移動だけ。回転・反転・任意拡大や小片だけの一致は許可しない。 */
function patternSimilarity(a: PreparedFingerprint, b: PreparedFingerprint): number {
  let best = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let weight = 0
      let squareA = 0
      let squareB = 0
      let product = 0
      const channelsA = [0, 0, 0]
      const channelsB = [0, 0, 0]
      for (let y = Math.max(0, -dy); y < Math.min(size, size - dy); y++) {
        for (let x = Math.max(0, -dx); x < Math.min(size, size - dx); x++) {
          const p = (y * size + x) * 4
          const q = ((y + dy) * size + x + dx) * 4
          const alpha = Math.min(a.pixels[p + 3]!, b.pixels[q + 3]!)
          weight += alpha
          for (let c = 0; c < 3; c++) {
            const va = a.pixels[p + c]!
            const vb = b.pixels[q + c]!
            channelsA[c]! += va * alpha
            channelsB[c]! += vb * alpha
            squareA += va * va * alpha
            squareB += vb * vb * alpha
            product += va * vb * alpha
          }
        }
      }
      // どちらかの小片だけが似ていても一致させない。
      if (weight < 16 || weight / Math.max(a.mass, b.mass) < 0.7)
        continue
      const sumA = channelsA.reduce((sum, value) => sum + value, 0)
      const sumB = channelsB.reduce((sum, value) => sum + value, 0)
      const spatialA = squareA - channelsA.reduce((sum, value) => sum + value * value / weight, 0)
      const spatialB = squareB - channelsB.reduce((sum, value) => sum + value * value / weight, 0)
      if (Math.min(spatialA, spatialB) / (weight * 3) < 0.0025)
        continue
      const varianceA = squareA - sumA * sumA / (weight * 3)
      const varianceB = squareB - sumB * sumB / (weight * 3)
      const correlation = (product - sumA * sumB / (weight * 3)) / Math.sqrt(varianceA * varianceB)
      best = Math.max(best, Math.min(1, correlation))
    }
  }
  return best
}

/** キャッシュは一回のグループ提案内だけ。指紋の再計算後に古い特徴を流用しない。 */
export function createDiscoveryComparator(): (a: AssetFingerprint, b: AssetFingerprint) => number {
  const cache = new WeakMap<AssetFingerprint, PreparedFingerprint | null>()
  const get = (fingerprint: AssetFingerprint) => {
    if (!cache.has(fingerprint))
      cache.set(fingerprint, prepare(fingerprint))
    return cache.get(fingerprint)!
  }
  return (a, b) => {
    const pa = get(a)
    const pb = get(b)
    if (!pa || !pb || !pa.mass || !pb.mass || !compatibleColor(pa.color, pb.color)) {
      return 0
    }
    const base = assetSimilarity(a, b)
    if (pa.textured !== pb.textured)
      return 0
    if (!pa.textured)
      return base
    // 輪郭が全く違うものを内部の色配置だけで救済しない。
    if (base < 0.5 || Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect) < 0.8)
      return 0
    return patternSimilarity(pa, pb)
  }
}
