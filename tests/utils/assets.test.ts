import { describe, expect, it } from 'vitest'
import {
  findUnresolvedAssetNames,
  updateRecroppedAsset,
  validateAssetName,
} from '~/utils/assets'

const assets = [
  { id: 'coin-id', name: 'coin' },
  { id: 'gem-id', name: 'gem' },
]

describe('asset guidance', () => {
  it('explains empty, invalid, and duplicate asset names', () => {
    expect(validateAssetName(' ', assets)).toContain('入力')
    expect(validateAssetName('bad:name', assets)).toContain('使用できません')
    expect(validateAssetName('coin', assets)).toContain('既に使用')
    expect(validateAssetName('coin', assets, 'coin-id')).toBeNull()
    expect(validateAssetName('shield', assets)).toBeNull()
  })

  it('returns unique unresolved token names in appearance order', () => {
    expect(findUnresolvedAssetNames(
      '[icon:coin] [icon:missing] [icon: missing ] [icon:other]',
      assets,
    )).toEqual(['missing', 'other'])
  })

  it('keeps display settings and identity when an asset is recropped', () => {
    const original = {
      id: 'coin-id',
      name: 'coin',
      sourceImageId: 'old-source',
      sourceRect: { x: 1, y: 2, width: 30, height: 40 },
      imagePath: 'assets/coin-id.png',
      scale: 1.25,
      baselineOffset: -0.15,
      inlinePadding: 0.2,
    }

    expect(updateRecroppedAsset(
      original,
      'gold',
      'new-source',
      { x: 10, y: 20, width: 50, height: 60 },
    )).toEqual({
      ...original,
      name: 'gold',
      sourceImageId: 'new-source',
      sourceRect: { x: 10, y: 20, width: 50, height: 60 },
    })
  })
})
