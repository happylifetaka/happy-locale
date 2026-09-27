import type { ComparedRegion } from '~/services/asset-discovery/region-comparison'
import type { IconOccurrence } from '~/types/asset-discovery'
import { describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { compareRegionDetections, rebaseRegionBounds } from '~/services/asset-discovery/region-comparison'
import { approveOccurrence, occurrenceIsApproved, proposedSourceIcons, reconcileApprovals, reconcileOccurrenceOwners, removeDiscoveryCards, reviseOccurrence } from '~/services/asset-discovery/review'

function occurrence(overrides: Partial<IconOccurrence> = {}): IconOccurrence {
  return {
    id: 'icon-1',
    cardId: 'card-1',
    imageDigest: 'image-v1',
    imageSize: { width: 500, height: 700 },
    bounds: { x: 40, y: 130, width: 20, height: 20 },
    detectedBounds: { x: 40, y: 130, width: 20, height: 20 },
    origin: 'detected',
    detectorRevision: 'components-v1',
    decision: 'pending',
    assetId: 'asset-1',
    approval: null,
    owner: { kind: 'candidate', id: 'candidate-1' },
    ...overrides,
  }
}

function editorFixture() {
  const editor = useCardEditor()
  editor.loadImageProject('synthetic.png', 500, 700)
  editor.addRegion({ x: 20, y: 100, width: 200, height: 100 }, '#123456')
  editor.updateRegion(editor.selectedRegionId.value!, {
    originalText: 'Original',
    translatedText: '既存の訳',
    translationStatus: 'reviewed',
    exclusionAreas: [{ id: 'protected', x: 60, y: 40, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 10, mode: 'paint', points: [{ x: 100, y: 40 }, { x: 130, y: 40 }] }],
  })
  return editor
}

describe('occurrence approval and ownership contracts', () => {
  it('binds approval to source identity, bounds, asset identity and actual asset revision', () => {
    const original = occurrence()
    const approved = approveOccurrence(original, 'image-v1', 'asset-png-v1')
    expect(original.decision).toBe('pending')
    expect(occurrenceIsApproved(approved, 'image-v1', 'asset-png-v1')).toBe(true)
    expect(occurrenceIsApproved(approved, 'image-v2', 'asset-png-v1')).toBe(false)
    expect(occurrenceIsApproved(approved, 'image-v1', 'asset-png-v2')).toBe(false)
    expect(occurrenceIsApproved({ ...approved, assetId: 'asset-2' }, 'image-v1', 'asset-png-v1')).toBe(false)
    expect(occurrenceIsApproved({ ...approved, bounds: { ...approved.bounds, x: 41 } }, 'image-v1', 'asset-png-v1')).toBe(false)
    expect(approved.approval!.bounds).not.toBe(original.bounds)
    expect(() => approveOccurrence(original, 'image-v2', 'asset-png-v1')).toThrow()
    expect(() => approveOccurrence(occurrence({ assetId: null }), 'image-v1', 'asset-png-v1')).toThrow()
  })

  it('invalidates edited or recropped assets but does not erase approval while image resources are loading', () => {
    const approved = approveOccurrence(occurrence(), 'image-v1', 'asset-png-v1')
    expect(reconcileApprovals([approved], new Map(), new Map())[0]).toBe(approved)
    expect(reconcileApprovals([approved], new Map([['card-1', 'image-v1']]), new Map([['asset-1', 'asset-png-v1']]))[0]).toBe(approved)
    expect(reconcileApprovals([approved], new Map(), new Map([['asset-1', 'asset-png-v2']]))[0]).toMatchObject({ decision: 'pending', approval: null, assetId: 'asset-1' })
    expect(reconcileApprovals([approved], new Map(), new Map([['asset-1', null]]))[0]).toMatchObject({ decision: 'pending', approval: null, assetId: null })
    expect(reconcileApprovals([approved], new Map([['card-1', null]]), new Map())[0]).toMatchObject({ decision: 'pending', approval: null })
    expect(reviseOccurrence(approved, approved.bounds, approved.assetId)).toBe(approved)
    expect(reviseOccurrence(approved, { ...approved.bounds, x: 41 }, approved.assetId)).toMatchObject({ decision: 'pending', approval: null })
    expect(reviseOccurrence(approved, approved.bounds, 'asset-2')).toMatchObject({ decision: 'pending', approval: null })
  })

  it('promotes candidate ownership and returns it to unassigned after deletion, shrink or undo', () => {
    const approved = approveOccurrence(occurrence(), 'image-v1', 'asset-png-v1')
    const region = { kind: 'region' as const, id: 'region-1', x: 20, y: 100, width: 200, height: 100 }
    const promoted = reconcileOccurrenceOwners([approved], 'card-1', [region], new Map([['candidate-1', 'region-1']]))[0]!
    expect(promoted.owner).toEqual({ kind: 'region', id: 'region-1' })
    expect(promoted.approval).toEqual(approved.approval)
    expect(reconcileOccurrenceOwners([promoted], 'card-1', [])[0]!.owner).toBeNull()
    expect(reconcileOccurrenceOwners([promoted], 'card-1', [{ ...region, x: 55 }])[0]!.owner).toBeNull()
    expect(reconcileOccurrenceOwners([promoted], 'another-card', [])[0]).toBe(promoted)
    const orphan = { ...promoted, owner: null }
    expect(reconcileOccurrenceOwners([orphan], 'card-1', [region])[0]).toBe(orphan)
  })

  it('cleans deleted-card group references without losing other candidates or their approval', () => {
    const first = occurrence()
    const second = approveOccurrence(occurrence({ id: 'icon-2', cardId: 'card-2' }), 'image-v1', 'asset-png-v1')
    const state = { occurrences: [first, second], groups: [
      { id: 'group-1', memberIds: [first.id, second.id], representativeId: first.id, name: 'name', proposedAssetId: null },
      { id: 'group-2', memberIds: [], representativeId: '', name: '', proposedAssetId: null },
    ] }
    const cleaned = removeDiscoveryCards(state, new Set(['card-1']))
    expect(cleaned.occurrences).toEqual([second])
    expect(cleaned.groups).toEqual([{ ...state.groups[0], memberIds: [second.id], representativeId: second.id }])
    expect(state.occurrences).toHaveLength(2)
  })

  it('prepares icons without changing the region, deduplicates re-application, and rejects stale or conflicting assignments', () => {
    const editor = editorFixture()
    const region = editor.project.value.regions[0]!
    const before = structuredClone(region)
    const approved = approveOccurrence(occurrence({ owner: { kind: 'region', id: region.id } }), 'image-v1', 'asset-png-v1')
    const digests = new Map([['asset-1', 'asset-png-v1']])
    const icons = proposedSourceIcons(region, [approved], 'card-1', 'image-v1', digests)
    expect(icons).toEqual([{ id: 'discovery-icon-1', assetId: 'asset-1', x: 20, y: 30, width: 20, height: 20 }])
    expect(region).toEqual(before)
    expect(proposedSourceIcons({ ...region, sourceIcons: icons }, [approved], 'card-1', 'image-v1', digests)).toEqual(icons)
    expect(() => proposedSourceIcons(region, [approved], 'card-1', 'image-v2', digests)).toThrow('承認')
    expect(() => proposedSourceIcons(region, [approved], 'card-1', 'image-v1', new Map())).toThrow('承認')
    expect(() => proposedSourceIcons({ ...region, sourceIcons: [{ ...icons[0]!, assetId: 'manual-asset' }] }, [approved], 'card-1', 'image-v1', digests)).toThrow('重な')
  })
})

describe('repeat region detection proposals', () => {
  const existing: ComparedRegion[] = [
    { kind: 'region', id: 'name', x: 20, y: 100, width: 200, height: 40 },
    { kind: 'region', id: 'body', x: 20, y: 200, width: 200, height: 100 },
  ]

  it('classifies unchanged, modified, new and undetected regions without modifying them', () => {
    expect(compareRegionDetections(existing, [{ ...existing[0]!, id: 'fresh-name' }, { id: 'fresh-new', x: 20, y: 400, width: 200, height: 30 }]))
      .toEqual([
        { status: 'unchanged', detectedId: 'fresh-name', targets: [{ kind: 'region', id: 'name' }] },
        { status: 'new', detectedId: 'fresh-new', targets: [] },
        { status: 'missing', detectedId: null, targets: [{ kind: 'region', id: 'body' }] },
      ])
    const next = { ...existing[1]!, x: 22, y: 202, width: 196, height: 96, id: 'fresh-body' }
    expect(compareRegionDetections(existing, [next])[0]!.status).toBe('changed')
    expect(compareRegionDetections([next], [next])[0]!.status).toBe('unchanged')
    expect(existing).toHaveLength(2)
  })

  it('does not auto-merge, auto-split or duplicate overlapping confirmed and candidate regions', () => {
    const joined = { id: 'joined', x: 20, y: 100, width: 200, height: 200 }
    expect(compareRegionDetections(existing, [joined])).toMatchObject([{ status: 'ambiguous', targets: [{ id: 'name' }, { id: 'body' }] }])
    const split = [{ id: 'a', x: 20, y: 200, width: 200, height: 45 }, { id: 'b', x: 20, y: 250, width: 200, height: 45 }]
    expect(compareRegionDetections([existing[1]!], split).map(d => d.status)).toEqual(['ambiguous', 'ambiguous'])
    const mixed = [existing[0]!, { ...existing[0]!, kind: 'candidate' as const }]
    expect(compareRegionDetections(mixed, [{ ...existing[0]!, id: 'new' }])[0]!.status).toBe('ambiguous')
    expect(() => compareRegionDetections([existing[0]!, existing[0]!], [])).toThrow()
    expect(() => compareRegionDetections(existing, [{ ...joined, x: Number.NaN }])).toThrow()
  })

  it('keeps original image coordinates and existing text/status and supports one-step undo/redo', () => {
    const editor = editorFixture()
    const region = editor.project.value.regions[0]!
    editor.updateRegion(region.id, { sourceIcons: [{ id: 'old', assetId: 'asset-1', x: 20, y: 30, width: 20, height: 20 }] })
    const original = structuredClone(editor.project.value.regions[0]!)
    const patch = rebaseRegionBounds(original, { x: 10, y: 90, width: 240, height: 130 }, 500, 700)
    expect(patch).not.toHaveProperty('originalText')
    expect(patch).not.toHaveProperty('translatedText')
    expect(patch).not.toHaveProperty('translationStatus')
    expect(patch.sourceIcons![0]).toMatchObject({ x: 30, y: 40 })
    expect(patch.exclusionAreas![0]).toMatchObject({ x: 70, y: 50 })
    expect(patch.manualMaskStrokes![0]!.points[0]).toEqual({ x: 110, y: 50 })
    editor.updateRegion(original.id, patch)
    expect(editor.project.value.regions[0]).toMatchObject({ originalText: 'Original', translatedText: '既存の訳', translationStatus: 'reviewed', id: original.id })
    editor.undo()
    expect(editor.project.value.regions[0]).toEqual(original)
    editor.redo()
    expect(editor.project.value.regions[0]!.x).toBe(10)
  })

  it('refuses cropping protected objects or brush footprints and expanding a previously clipped mask', () => {
    const editor = editorFixture()
    const region = editor.project.value.regions[0]!
    expect(() => rebaseRegionBounds(region, { x: 85, y: 100, width: 135, height: 100 }, 500, 700)).toThrow('保護')
    expect(() => rebaseRegionBounds(region, { x: 20, y: 138, width: 200, height: 62 }, 500, 700)).toThrow()
    const clipped = { ...region, manualMaskStrokes: [{ brushSize: 20, points: [{ x: 2, y: 20 }] }] }
    expect(() => rebaseRegionBounds(clipped, { x: 10, y: 100, width: 210, height: 100 }, 500, 700)).toThrow('拡張')
    expect(() => rebaseRegionBounds(clipped, region, 500, 700)).not.toThrow()
    expect(() => rebaseRegionBounds(region, { x: -1, y: 100, width: 200, height: 100 }, 500, 700)).toThrow('画像')
  })
})
