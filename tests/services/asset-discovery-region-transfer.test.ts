import { expect, it } from 'vitest'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { mapDiscoveryToRegions, withoutTransferredIcons } from '~/services/asset-discovery/region-transfer'
import { discoveryProject } from '../fixtures/asset-discovery'

function setup() {
  const project = discoveryProject()
  const card = project.cards[0]!
  const state = project.assetDiscovery!
  const region = regionFromCandidate(card.ocrCandidates![0]!, 0)
  const regions = [region]
  const digest = 'a'.repeat(64)
  const hashes = new Map([['asset-1', 'b'.repeat(64)]])
  const map = () => mapDiscoveryToRegions(state, card.id, regions, digest, { width: 200, height: 240 }, project.assets, hashes)
  return { project, state, region, regions, hashes, map }
}

it('reassigns original-image coordinates to a new region without changing the saved approval or old owner', () => {
  const s = setup()
  s.state.occurrences[0]!.decision = 'pending'
  s.state.occurrences[0]!.approval = null
  const before = JSON.stringify(s.state)
  const mapped = s.map()
  expect(mapped.warnings).toEqual([])
  expect(mapped.blocked.size).toBe(0)
  expect(mapped.mapped.get(s.region.id)![0]).toMatchObject({ owner: { kind: 'region', id: s.region.id }, decision: 'accepted', bounds: { x: 40, y: 50, width: 20, height: 20 } })
  expect(JSON.stringify(s.state)).toBe(before)
  s.region.id = 'different-region'
  expect(s.map().mapped.has('different-region')).toBe(true)
})

it.each(['crossing', 'two-owners', 'outside', 'image-changed', 'size-changed', 'unassigned', 'mixed-group', 'missing-png'] as const)('does not apply %s and preserves the candidate', (reason) => {
  const s = setup()
  if (reason === 'crossing')
    s.region.x = 50
  if (reason === 'two-owners')
    s.regions.push({ ...s.region, id: 'overlap' })
  if (reason === 'outside')
    s.region.x = 100
  if (reason === 'image-changed')
    s.state.occurrences[0]!.imageDigest = 'c'.repeat(64)
  if (reason === 'size-changed')
    s.state.occurrences[0]!.imageSize.width++
  if (reason === 'unassigned')
    s.state.occurrences[0]!.assetId = null
  if (reason === 'mixed-group') {
    s.state.occurrences.push({ ...s.state.occurrences[0]!, id: 'other', assetId: null })
    s.state.groups[0]!.memberIds.push('other')
  }
  if (reason === 'missing-png')
    s.hashes.clear()
  const before = JSON.stringify(s.state)
  const result = s.map()
  expect(result.mapped.size).toBe(0)
  expect(result.warnings.length).toBeGreaterThan(0)
  expect(result.blocked.has(s.region.id)).toBe(reason !== 'outside')
  expect(JSON.stringify(s.state)).toBe(before)
})

it('ignores excluded candidates, and removes only prior generated relative positions', () => {
  const s = setup()
  s.state.occurrences[0]!.decision = 'excluded'
  expect(s.map().warnings).toEqual([])
  expect(s.map().mapped.size).toBe(0)
  const icon = { id: 'manual', assetId: 'asset-1', x: 1, y: 2, width: 10, height: 10 }
  s.region.sourceIcons = [icon, { ...icon, id: 'discovery-old' }]
  expect(withoutTransferredIcons(s.region).sourceIcons).toEqual([icon])
  expect(s.region.sourceIcons).toHaveLength(2)
})
