import type { useDiscoveryReview } from './useDiscoveryReview'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { DiscoveryAssetMatches } from '~/services/asset-discovery/asset-matches'
import type { OccurrenceAssetChoice } from '~/services/asset-discovery/review-operations'
import type { useProjectStore } from '~/stores/project'
import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue'
import { prepareDiscoveryAssetCatalog } from '~/services/asset-discovery/asset-catalog'
import { chooseDiscoveryAssetMatch, matchCardIconsToAssets } from '~/services/asset-discovery/asset-matches'
import { createImageDigestCache } from '~/services/asset-discovery/digest'

interface DiscoveryAssetMatchingOptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'assets' | 'assetDiscovery'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'projectGeneration' | 'cardSourceFile' | 'assetFiles' | 'pendingAssetWrites'>
  currentCard: () => { id: string, imageWidth: number, imageHeight: number } | null
  review: Pick<ReturnType<typeof useDiscoveryReview>, 'linkAssetChoices'>
  busy?: () => boolean
}

/** 照合結果を明示的なレビュー操作へ渡す。承認・原文・PNGの書込は行わない。 */
export function useDiscoveryAssetMatching({ store, runtime, currentCard, review, busy = () => false }: DiscoveryAssetMatchingOptions) {
  const active = shallowRef<{ current: () => boolean } | null>(null)
  const result = shallowRef<DiscoveryAssetMatches | null>(null)
  const running = shallowRef(false)
  let disposed = false

  function cancel() {
    active.value = null
    result.value = null
    running.value = false
  }

  // 同一tick内で変更→Undoしても、以前の要求・提案を復活させない。
  watchEffect(() => {
    if (active.value && !active.value.current())
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancel()
  })

  async function analyze(): Promise<DiscoveryAssetMatches | null> {
    if (disposed || busy() || running.value)
      return null
    cancel()
    const card = currentCard()
    const state = store.assetDiscovery
    const file = runtime.cardSourceFile.value
    if (!card || !state?.occurrences.some(item => item.cardId === card.id))
      return null
    if (!file)
      throw new Error('元画像を読み込んでからアセットを照合してください。')
    const snapshot = { id: card.id, imageWidth: card.imageWidth, imageHeight: card.imageHeight }
    const stateText = JSON.stringify(state)
    const generation = runtime.projectGeneration.value
    const files = runtime.assetFiles.value
    const writes = runtime.pendingAssetWrites.value
    const assets = store.assets
    const assetSources = assets.map(asset => ({ id: asset.id, blob: writes.get(asset.id) ?? files.get(asset.id) }))
    let invalidated = false
    const request = {
      current: () => {
        const current = currentCard()
        invalidated ||= disposed || busy() || active.value !== request || generation !== runtime.projectGeneration.value
          || current?.id !== snapshot.id || current.imageWidth !== snapshot.imageWidth || current.imageHeight !== snapshot.imageHeight
          || file !== runtime.cardSourceFile.value || files !== runtime.assetFiles.value || writes !== runtime.pendingAssetWrites.value
          || assets !== store.assets || state !== store.assetDiscovery || stateText !== JSON.stringify(store.assetDiscovery)
          || assetSources.length !== assets.length || assetSources.some((source, index) => assets[index]?.id !== source.id || source.blob !== (writes.get(source.id) ?? files.get(source.id)))
        return !invalidated
      },
    }
    active.value = request
    running.value = true
    const digestCache = createImageDigestCache()
    try {
      const catalog = await prepareDiscoveryAssetCatalog({ assets, assetFiles: files, pendingAssetWrites: writes, isCurrent: request.current, digestCache })
      if (!catalog || !request.current())
        return null
      const proposal = await matchCardIconsToAssets({ card: snapshot, file, occurrences: state.occurrences.filter(item => item.cardId === card.id), catalog, isCurrent: request.current, digestCache })
      if (!proposal || !request.current())
        return null
      result.value = proposal
      return proposal
    }
    catch (error) {
      if (!request.current())
        return null
      throw error
    }
    finally {
      if (active.value === request) {
        running.value = false
        if (!result.value)
          cancel()
      }
    }
  }

  function chooseMany(proposal: DiscoveryAssetMatches, choices: readonly OccurrenceAssetChoice[]): void {
    if (!active.value?.current() || running.value || result.value !== proposal)
      throw new Error('一致提案が古いか対象が変わりました。再照合してください。')
    if (!choices.length)
      return
    const validated = choices.map((choice) => {
      const occurrence = store.assetDiscovery?.occurrences.find(item => item.id === choice.occurrenceId)
      if (!occurrence)
        throw new Error('一致提案の対象が変わりました。再照合してください。')
      return chooseDiscoveryAssetMatch(proposal, occurrence, choice.assetId)
    })
    // 全選択を先に検証し、異なる登録先も一つのUndoにまとめる。
    review.linkAssetChoices(validated)
    cancel()
  }

  function choose(proposal: DiscoveryAssetMatches, occurrenceId: string, assetId: string): void {
    chooseMany(proposal, [{ occurrenceId, assetId }])
  }

  return {
    running: computed(() => running.value),
    proposal: computed(() => active.value?.current() ? result.value : null),
    analyze,
    choose,
    chooseMany,
    cancel,
  }
}
