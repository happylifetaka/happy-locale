import type { AssetDiscoveryState } from '~/types/asset-discovery'
import { baselineProject } from './refactoring-baseline'

/** Public fixtures contain only invented geometry and content digests. */
export function discoveryProject() {
  const project = baselineProject()
  const bounds = { x: 40, y: 50, width: 20, height: 20 }
  const line = { x: 10, y: 20, width: 140, height: 100, text: 'Synthetic effect.', confidence: 90 }
  project.cards[0]!.ocrCandidates = [{ ...line, id: 'candidate-1', selected: true, lines: [line] }]
  project.assets = [{
    id: 'asset-1',
    name: 'synthetic-icon',
    sourceImageId: project.activeCardId,
    sourceRect: bounds,
    imagePath: 'assets/asset-1.png',
    scale: 1,
    baselineOffset: 0,
    inlinePadding: 0,
  }]
  const state: AssetDiscoveryState = {
    occurrences: [{
      id: 'occurrence-1',
      cardId: project.activeCardId,
      imageDigest: 'a'.repeat(64),
      imageSize: { width: 200, height: 240 },
      bounds: { ...bounds },
      detectedBounds: { ...bounds },
      origin: 'detected',
      detectorRevision: 'synthetic-v1',
      decision: 'accepted',
      assetId: 'asset-1',
      owner: { kind: 'candidate', id: 'candidate-1' },
      approval: { imageDigest: 'a'.repeat(64), bounds: { ...bounds }, assetId: 'asset-1', assetDigest: 'b'.repeat(64) },
    }],
    groups: [{ id: 'group-1', name: 'Synthetic group', memberIds: ['occurrence-1'], representativeId: 'occurrence-1', proposedAssetId: 'asset-1' }],
  }
  project.assetDiscovery = state
  return project
}
