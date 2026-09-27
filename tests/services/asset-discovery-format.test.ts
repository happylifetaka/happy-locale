import type { AssetDiscoveryState } from '~/types/asset-discovery'
import { describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { parseAssetDiscovery } from '~/services/asset-discovery/format'
import { removeDiscoveryAssets } from '~/services/asset-discovery/review'

function fixture() {
  const editor = useCardEditor()
  editor.loadImageProject('synthetic.png', 500, 700)
  editor.addRegion({ x: 20, y: 100, width: 200, height: 100 }, '#123456')
  const state: AssetDiscoveryState = {
    occurrences: [{
      id: 'occurrence',
      cardId: 'card',
      imageDigest: 'a'.repeat(64),
      imageSize: { width: 500, height: 700 },
      bounds: { x: 40, y: 130, width: 20, height: 20 },
      detectedBounds: { x: 40, y: 130, width: 20, height: 20 },
      origin: 'detected',
      detectorRevision: 'components-v1',
      decision: 'accepted',
      assetId: 'asset',
      approval: {
        imageDigest: 'a'.repeat(64),
        bounds: { x: 40, y: 130, width: 20, height: 20 },
        assetId: 'asset',
        assetDigest: 'b'.repeat(64),
      },
      owner: { kind: 'region', id: editor.selectedRegionId.value! },
    }],
    groups: [{ id: 'group', memberIds: ['occurrence'], representativeId: 'occurrence', name: '候補', proposedAssetId: 'asset' }],
  }
  return { state, context: { cards: [{ id: 'card', ...editor.project.value }], assetIds: new Set(['asset']) } }
}

describe('discovery persistence contract', () => {
  it('validates and copies JSON-safe approval, membership and original image coordinates', () => {
    const { state, context } = fixture()
    const parsed = parseAssetDiscovery(JSON.parse(JSON.stringify(state)), context)
    expect(parsed).toEqual(state)
    expect(parsed.occurrences[0]!.bounds).not.toBe(state.occurrences[0]!.bounds)
    expect(parsed.groups[0]!.memberIds).not.toBe(state.groups[0]!.memberIds)
    expect(parseAssetDiscovery({ occurrences: [], groups: [] }, context)).toEqual({ occurrences: [], groups: [] })
  })

  it.each([
    (s: AssetDiscoveryState) => { s.occurrences[0]!.bounds.x = -1 },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.bounds.width = Number.NaN },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.bounds.width = 1000 },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.imageDigest = 'not-a-digest' },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.imageSize.width = Number.NaN },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.imageSize.height = 800 },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.cardId = 'missing' },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.assetId = 'missing' },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.approval = null },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.approval!.bounds.x = 45 },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.approval!.imageDigest = 'c'.repeat(64) },
    (s: AssetDiscoveryState) => { s.occurrences[0]!.owner!.id = 'missing' },
    (s: AssetDiscoveryState) => { s.occurrences.push(structuredClone(s.occurrences[0]!)) },
    (s: AssetDiscoveryState) => { s.groups[0]!.memberIds.push('occurrence') },
    (s: AssetDiscoveryState) => { s.groups[0]!.memberIds = ['missing'] },
    (s: AssetDiscoveryState) => { s.groups[0]!.representativeId = 'missing' },
    (s: AssetDiscoveryState) => { s.groups[0]!.proposedAssetId = 'missing' },
    (s: AssetDiscoveryState) => { s.groups.push({ ...s.groups[0]!, id: 'second' }) },
  ])('rejects malformed approval, bounds and cross-collection references (%#)', (mutate) => {
    const { state, context } = fixture()
    mutate(state)
    expect(() => parseAssetDiscovery(state, context)).toThrow('保存データ')
  })

  it('accepts unassigned and excluded candidates but not a forged approval of an excluded candidate', () => {
    const { state, context } = fixture()
    state.occurrences[0] = { ...state.occurrences[0]!, decision: 'excluded', approval: null, owner: null, assetId: null }
    expect(parseAssetDiscovery(state, context).occurrences[0]).toMatchObject({ decision: 'excluded', owner: null })
    state.occurrences[0]!.approval = { imageDigest: 'a'.repeat(64), bounds: state.occurrences[0]!.bounds, assetId: 'asset', assetDigest: 'b'.repeat(64) }
    expect(() => parseAssetDiscovery(state, context)).toThrow()
  })

  it('bounds card and project candidate counts before expensive processing', () => {
    const { state, context } = fixture()
    state.occurrences = Array.from({ length: 101 }, (_, index) => ({ ...state.occurrences[0]!, id: `occurrence-${index}` }))
    state.groups = []
    expect(() => parseAssetDiscovery(state, context)).toThrow('カード内')
    expect(() => parseAssetDiscovery({ occurrences: Array.from({ length: 2001 }), groups: [] }, context)).toThrow('候補・グループ数')
  })

  it('clears references on asset deletion and keeps the remaining review document valid', () => {
    const { state, context } = fixture()
    const next = removeDiscoveryAssets(state, new Set(['asset']))
    expect(next.occurrences[0]).toMatchObject({ decision: 'pending', assetId: null, approval: null })
    expect(next.groups[0]!.proposedAssetId).toBeNull()
    expect(state.occurrences[0]!.decision).toBe('accepted')
    expect(parseAssetDiscovery(next, { ...context, assetIds: new Set() })).toEqual(next)
  })
})
