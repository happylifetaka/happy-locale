import { expect, it } from 'vitest'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { fitIconRegions, minimalIconExpansion } from '~/services/asset-discovery/region-fit'
import { discoveryProject } from '../fixtures/asset-discovery'

function setup() {
  const project = discoveryProject()
  const region = regionFromCandidate(project.cards[0]!.ocrCandidates![0]!, 0)
  region.height = 47 // bottom 67; icon bottom 70
  const icon = project.assetDiscovery!.occurrences[0]!
  const regions = [region]
  const icons = [icon]
  const size = { width: 200, height: 240 }
  return { region, icon, regions, icons, size, fit: () => fitIconRegions(regions, icons, size) }
}

it('minimally extends a 3px protrusion in a copy', () => {
  const s = setup()
  const before = JSON.stringify(s.regions)
  expect(s.fit().regions[0]).toMatchObject({ x: 10, y: 20, width: 140, height: 50 })
  expect(s.fit().reasons.size).toBe(0)
  expect(JSON.stringify(s.regions)).toBe(before)
})

it('rebases manual icons, protections and mask points without moving image coordinates', () => {
  const s = setup()
  s.icon.bounds = { x: 7, y: 17, width: 20, height: 20 }
  s.region.sourceIcons = [{ id: 'manual', assetId: 'asset-1', x: 30, y: 30, width: 10, height: 10 }]
  s.region.exclusionAreas = [{ id: 'protected', x: 40, y: 30, width: 10, height: 10 }]
  s.region.manualMaskStrokes = [{ mode: 'erase', brushSize: 4, points: [{ x: 20, y: 20 }] }]
  const result = s.fit().regions[0]!
  expect(result).toMatchObject({ x: 7, y: 17, width: 143, height: 50 })
  expect(result.sourceIcons![0]).toMatchObject({ x: 33, y: 33 })
  expect(result.exclusionAreas[0]).toMatchObject({ x: 43, y: 33 })
  expect(result.manualMaskStrokes[0]!.points).toEqual([{ x: 23, y: 23 }])
})

it('enforces both the absolute and icon-relative budget, including boundary and invalid inputs', () => {
  const region = { x: 10, y: 10, width: 100, height: 100 }
  expect(minimalIconExpansion(region, [{ x: 20, y: 94, width: 20, height: 20 }])).toMatchObject({ height: 104 })
  expect(minimalIconExpansion(region, [{ x: 20, y: 95, width: 20, height: 20 }])).toBeNull()
  expect(minimalIconExpansion(region, [{ x: 20, y: 68, width: 50, height: 50 }])).toMatchObject({ height: 108 })
  expect(minimalIconExpansion(region, [{ x: 20, y: 69, width: 50, height: 50 }])).toBeNull()
  expect(minimalIconExpansion(region, [{ x: 20, y: 110, width: 20, height: 20 }])).toBeNull()
  expect(minimalIconExpansion(region, [{ x: Number.NaN, y: 10, width: 20, height: 20 }])).toBeNull()
})

it.each(['collision', 'ambiguous', 'outside-image', 'mask'] as const)('keeps original frames on %s', (reason) => {
  const s = setup()
  if (reason === 'collision')
    s.regions.push({ ...s.region, id: 'other', x: 100, y: 68 })
  if (reason === 'ambiguous')
    s.regions.push({ ...s.region, id: 'other' })
  if (reason === 'outside-image')
    s.size.height = 68
  if (reason === 'mask')
    s.region.manualMaskStrokes = [{ mode: 'erase', brushSize: 10, points: [{ x: 20, y: 46 }] }]
  expect(s.fit().regions).toEqual(s.regions)
  expect(s.fit().reasons.has(s.icon.id)).toBe(true)
})

it('rejects both conflicting expansion plans independent of order', () => {
  const s = setup()
  s.regions.push({ ...s.region, id: 'other', y: 72 })
  s.icons.push({ ...s.icon, id: 'other-icon', bounds: { x: 100, y: 69, width: 20, height: 20 } })
  expect(s.fit().regions).toEqual(s.regions)
  expect(s.fit().reasons.size).toBe(2)
  s.regions.reverse()
  s.icons.reverse()
  expect(s.fit().regions).toEqual(s.regions)
})

it('does not adopt an originally unowned icon caught by another expansion', () => {
  const s = setup()
  s.icons.push({ ...s.icon, id: 'outside', bounds: { x: 100, y: 67, width: 2, height: 2 } })
  expect(s.fit().regions[0]!.height).toBe(50)
  expect(s.fit().reasons.get('outside')).toContain('対応する領域がありません')
})
