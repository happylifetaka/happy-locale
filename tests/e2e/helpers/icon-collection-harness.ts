import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { effectScope, watch } from 'vue'
import { useProjectRuntime } from '../../../app/composables/useProjectRuntime'
import { useDiscoveryCollection } from '../../../app/features/cards/useDiscoveryCollection'
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
  const runtime = useProjectRuntime()
  const scope = effectScope()
  const root = await navigator.storage.getDirectory()
  const testDirectoryName = `icon-collection-${crypto.randomUUID()}`
  const directory = await root.getDirectoryHandle(testDirectoryName, { create: true })
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
    const imageDirectory = await directory.getDirectoryHandle('images', { create: true })
    for (const id of ['one', 'two']) {
      const writer = await (await imageDirectory.getFileHandle(`${id}.png`, { create: true })).createWritable()
      await writer.write(file)
      await writer.close()
    }
    runtime.setDirectory(directory)
    runtime.cardSourceFile.value = file
    const project = baselineProject()
    project.activeCardId = 'one'
    const base = project.cards[0]!
    project.cards = ['one', 'two', 'missing'].map(id => ({ ...base, id, imagePath: `images/${id}.png`, imageWidth: 600, imageHeight: 900, ocrCandidates: [{ id: `effect-${id}`, x: 60, y: 540, width: 360, height: 120, text: 'Keep OCR candidate', confidence: 90, selected: true, lines: [] }] }))
    store.replaceProject(project)
    const context = () => ({ cards: store.document!.cards, assetIds: new Set<string>() })
    const loadOrder: string[] = []
    const controller = scope.run(() => useDiscoveryCollection({
      store,
      runtime,
      currentImageId: () => store.document!.activeCardId,
      getProvider: async () => provider,
    }))!
    scope.run(() => watch(() => controller.progress.value.cardId, (id) => {
      if (id)
        loadOrder.push(id)
    }, { flush: 'sync' }))
    const cardIds = project.cards.map(card => card.id)
    const cardsBefore = store.snapshot()!.cards
    const first = (await controller.start(cardIds))!
    const stored = store.snapshot()!
    const roundtripped = parseFolderProject(serializeFolderProject(stored))
    store.replaceProject(roundtripped)
    const organized = structuredClone(store.assetDiscovery!)
    organized.groups[0]!.name = 'Keep manual group name'
    organized.occurrences[0]!.decision = 'excluded'
    store.setAssetDiscovery(organized)
    const beforeRepeat = serializeFolderProject(store.snapshot()!)
    const second = (await controller.start(cardIds))!
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
      execution: { running: controller.running.value, progress: controller.progress.value, hasResult: controller.result.value === second },
    }
  }
  finally {
    scope.stop()
    runtime.dispose()
    store.$dispose()
    setActivePinia(previousPinia)
    canvas.width = canvas.height = 1
    try {
      await provider.dispose()
    }
    finally {
      // Only remove the uniquely named synthetic OPFS directory created by this test.
      await root.removeEntry(testDirectoryName, { recursive: true })
    }
  }
}
