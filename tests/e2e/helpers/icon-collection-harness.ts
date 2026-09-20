import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { collectStoredIconDiscoveryBatch } from '../../../app/services/asset-discovery/collection'
import { compareIconProposal } from '../../../app/services/asset-discovery/proposal-review'
import { TesseractOCRProvider } from '../../../app/services/ocr/tesseract'
import { parseFolderProject, serializeFolderProject } from '../../../app/services/project/format'
import { useProjectStore } from '../../../app/stores/project'
import { baselineProject } from '../../fixtures/refactoring-baseline'

/** Uses only generated pixels and an isolated Store; no mounted project or local files are touched. */
export async function runIconCollectionScenario() {
  const previousPinia = getActivePinia()
  const store = useProjectStore(createPinia())
  const provider = new TesseractOCRProvider('/')
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 900
  try {
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#182028'
    ctx.fillRect(0, 0, 600, 900)
    ctx.fillStyle = '#fafafa'
    ctx.font = '28px serif'
    ctx.fillText('Gain two tokens', 80, 610)
    ctx.fillStyle = '#ee3030'
    ctx.fillRect(275, 574, 32, 42)
    ctx.fillStyle = '#a0a0a0'
    ctx.fillRect(320, 574, 32, 42)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
    const file = new File([png], 'synthetic.png', { type: 'image/png' })
    const project = baselineProject()
    project.activeCardId = 'one'
    const base = project.cards[0]!
    project.cards = ['one', 'two', 'missing'].map(id => ({ ...base, id, imageWidth: 600, imageHeight: 900, ocrCandidates: [{ id: `effect-${id}`, x: 60, y: 540, width: 360, height: 120, text: 'Keep OCR candidate', confidence: 90, selected: true, lines: [] }] }))
    store.replaceProject(project)
    const context = () => ({ cards: store.document!.cards, assetIds: new Set<string>() })
    const loadOrder: string[] = []
    const options = {
      store,
      context,
      batch: {
        cards: project.cards,
        provider,
        loadFile: async (card: { id: string }) => {
          loadOrder.push(card.id)
          if (card.id === 'missing')
            throw new Error('Synthetic missing image')
          return file
        },
        isCurrent: () => true,
        cardIsCurrent: () => true,
        cancelled: () => false,
        maximumProposedCandidates: 2000,
      },
    }
    const cardsBefore = store.snapshot()!.cards
    const first = await collectStoredIconDiscoveryBatch(options)
    const stored = store.snapshot()!
    const roundtripped = parseFolderProject(serializeFolderProject(stored))
    store.replaceProject(roundtripped)
    const organized = structuredClone(store.assetDiscovery!)
    organized.groups[0]!.name = 'Keep manual group name'
    organized.occurrences[0]!.decision = 'excluded'
    store.setAssetDiscovery(organized)
    const beforeRepeat = serializeFolderProject(store.snapshot()!)
    const second = await collectStoredIconDiscoveryBatch(options)
    const reviewContext = { ...context(), imageDigests: new Map(second.proposals.map(proposal => [proposal.cardId, proposal.imageDigest])), assetDigests: new Map<string, string>() }
    const comparisons = second.proposals.map(proposal => compareIconProposal(store.assetDiscovery!, proposal, reviewContext))
    return {
      first: { staged: first.staged, failures: first.failures, groupingError: first.groupingError, limits: first.proposals.map(proposal => proposal.limitsHit) },
      stored: stored.assetDiscovery,
      roundtripPreserved: JSON.stringify(roundtripped.assetDiscovery) === JSON.stringify(stored.assetDiscovery),
      cardsBefore,
      cardsAfterCollection: stored.cards,
      cardsAfterRepeat: store.snapshot()!.cards,
      second: { staged: second.staged, failures: second.failures, groupingError: second.groupingError },
      repeatDidNotWrite: beforeRepeat === serializeFolderProject(store.snapshot()!),
      comparisonStatuses: comparisons.flatMap(review => review.differences.map(item => item.status)),
      loadOrder,
    }
  }
  finally {
    store.$dispose()
    setActivePinia(previousPinia)
    canvas.width = canvas.height = 1
    await provider.dispose()
  }
}
