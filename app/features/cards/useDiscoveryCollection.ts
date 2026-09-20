import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { DiscoveryCard } from '~/services/asset-discovery/collect'
import type { IconDiscoverySettings } from '~/services/asset-discovery/types'
import type { OCRProvider } from '~/services/ocr/types'
import type { useProjectStore } from '~/stores/project'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue'
import { collectStoredIconDiscoveryBatch } from '~/services/asset-discovery/collection'
import { ASSET_DISCOVERY_LIMITS } from '~/services/asset-discovery/format'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from '~/services/asset-discovery/types'
import { loadFolderProjectCardImage } from '~/services/project/folder'

interface DiscoveryCollectionOptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'document' | 'draftCard' | 'draftOCRCandidates' | 'assetDiscovery' | 'assets' | 'setAssetDiscovery'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'projectGeneration' | 'directory' | 'cardSourceFile'>
  currentImageId: () => string
  getProvider: () => Promise<OCRProvider>
  pendingDeletionIds?: () => ReadonlySet<string>
  settings?: () => Readonly<IconDiscoverySettings>
  /** 表示中エディターの未確定変更など、保存用Store以外の依存先。 */
  scope?: () => readonly unknown[]
  /** 共有OCR・保存・カード切替など。自身のrunningは含めない。 */
  busy?: () => boolean
}

type CollectionResult = Awaited<ReturnType<typeof collectStoredIconDiscoveryBatch>>
interface CollectionRequest {
  current: () => boolean
  cancelled: boolean
  expectedDiscovery: string
}

const discoverySignature = (state: AssetDiscoveryState | undefined) => JSON.stringify(state ?? null)

/** 明示したカードの収集を制御する。共有Workerを解放せず、中止後も実処理の終了まで再実行を拒否する。 */
export function useDiscoveryCollection({ store, runtime, currentImageId, getProvider, pendingDeletionIds = () => new Set(), settings = () => DEFAULT_ICON_DISCOVERY_SETTINGS, scope = () => [], busy = () => false }: DiscoveryCollectionOptions) {
  const active = shallowRef<CollectionRequest | null>(null)
  const result = shallowRef<CollectionResult | null>(null)
  const running = shallowRef(false)
  const cancelRequested = shallowRef(false)
  const progress = shallowRef<{ total: number, started: number, cardId: string | null }>({ total: 0, started: 0, cardId: null })
  let disposed = false

  // Store操作と同じtickで編集→Undoしても、古い要求・差分を復活させない。
  watchEffect(() => {
    if (active.value && !active.value.current()) {
      result.value = null
      cancelRequested.value = running.value
      progress.value = { ...progress.value, cardId: null }
    }
  }, { flush: 'sync' })

  function cancel() {
    if (active.value && running.value) {
      active.value.cancelled = true
      cancelRequested.value = true
    }
  }
  onScopeDispose(() => {
    disposed = true
    cancel()
    active.value = null
    result.value = null
  })

  async function start(cardIds: readonly string[]): Promise<CollectionResult | null> {
    if (disposed || busy() || running.value)
      return null
    active.value = null
    result.value = null
    progress.value = { total: 0, started: 0, cardId: null }
    cancelRequested.value = false
    const ids = [...cardIds]
    if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length)
      throw new Error('収集するカードを重複なく選んでください。')
    const documentCards = store.document?.cards
    const draftCard = store.draftCard
    const draftCandidates = store.draftOCRCandidates
    const imageId = currentImageId()
    const source = runtime.cardSourceFile.value
    const directory = runtime.directory.value
    const generation = runtime.projectGeneration.value
    const dependencies = [...scope()]
    const initialSettings = JSON.stringify(settings())
    const readCards = (): readonly DiscoveryCard[] => store.document?.cards ?? [{ ...store.draftCard, id: currentImageId(), ocrCandidates: store.draftOCRCandidates }]
    const byId = new Map(readCards().map(card => [card.id, card]))
    if (ids.some(id => !byId.has(id) || pendingDeletionIds().has(id)))
      throw new Error('収集対象が存在しないか削除予定です。選び直してください。')
    if ((!documentCards && (!imageId || !source)) || (documentCards && !directory))
      throw new Error('収集する元画像またはプロジェクトフォルダを開いてください。')
    // JSON互換データを複製し、VueのProxyをキューへ渡さない。
    const cards = JSON.parse(JSON.stringify(ids.map(id => byId.get(id)!))) as DiscoveryCard[]
    const originalCards = JSON.stringify(cards)
    let invalidated = false
    const request: CollectionRequest = {
      cancelled: false,
      expectedDiscovery: discoverySignature(store.assetDiscovery),
      current: () => {
        const currentDependencies = scope()
        const currentById = new Map(readCards().map(card => [card.id, card]))
        invalidated ||= disposed || busy() || active.value !== request
          || runtime.projectGeneration.value !== generation || runtime.directory.value !== directory
          || currentImageId() !== imageId || runtime.cardSourceFile.value !== source
          || store.document?.cards !== documentCards
          || (!documentCards && (store.draftCard !== draftCard || store.draftOCRCandidates !== draftCandidates))
          || ids.some(id => pendingDeletionIds().has(id))
          || JSON.stringify(ids.map(id => currentById.get(id))) !== originalCards
          || JSON.stringify(settings()) !== initialSettings || discoverySignature(store.assetDiscovery) !== request.expectedDiscovery
          || dependencies.length !== currentDependencies.length || dependencies.some((value, i) => value !== currentDependencies[i])
        return !invalidated
      },
    }
    active.value = request
    running.value = true
    progress.value = { total: cards.length, started: 0, cardId: null }
    try {
      const provider = await getProvider()
      if (!request.current() || request.cancelled)
        return null
      const collected = await collectStoredIconDiscoveryBatch({
        store: {
          get assetDiscovery() { return store.assetDiscovery },
          setAssetDiscovery: (next, draftId) => {
            if (!request.current())
              throw new Error('収集対象が変更されました。再実行してください。')
            // 自分の保存だけを許可し、同期監視中の別操作による変更は失効させる。
            const previous = request.expectedDiscovery
            request.expectedDiscovery = discoverySignature(next)
            try {
              store.setAssetDiscovery(next, draftId)
            }
            catch (error) {
              request.expectedDiscovery = previous
              throw error
            }
          },
        },
        context: () => ({ cards: readCards(), assetIds: new Set(store.assets.map(asset => asset.id)) }),
        draftCardId: documentCards ? undefined : imageId,
        batch: {
          cards,
          provider,
          settings: JSON.parse(initialSettings) as IconDiscoverySettings,
          maximumProposedCandidates: ASSET_DISCOVERY_LIMITS.project,
          isCurrent: request.current,
          cardIsCurrent: request.current,
          cancelled: () => request.cancelled,
          loadFile: async (card) => {
            progress.value = { total: cards.length, started: progress.value.started + 1, cardId: card.id }
            if (card.id === imageId && source)
              return source
            const original = documentCards?.find(item => item.id === card.id)
            if (!directory || !original)
              throw new Error('収集するカードの元画像が見つかりません。')
            return loadFolderProjectCardImage(directory, original)
          },
        },
      })
      if (!request.current())
        return null
      result.value = collected
      return collected
    }
    catch (error) {
      if (!request.current() || request.cancelled)
        return null
      throw error
    }
    finally {
      running.value = false
      progress.value = { ...progress.value, cardId: null }
      if (!result.value)
        active.value = null
    }
  }

  return {
    running: computed(() => running.value),
    cancelRequested: computed(() => cancelRequested.value),
    progress: computed(() => progress.value),
    result: computed(() => active.value?.current() ? result.value : null),
    start,
    cancel,
  }
}
