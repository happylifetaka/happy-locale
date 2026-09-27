import type { Ref } from 'vue'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import { onScopeDispose, readonly, ref, shallowRef, watch } from 'vue'
import { createImageDigestCache } from '~/services/asset-discovery/digest'

export interface DiscoveryImageIdentity {
  cardId: string
  imageDigest: string | null
  assetDigests: ReadonlyMap<string, string>
  errors: ReadonlyMap<string, string>
}

interface DiscoveryImageIdentityOptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'assets' | 'assetDiscovery' | 'reconcileAssetDiscoveryContent'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'projectGeneration' | 'cardSourceFile' | 'assetFiles' | 'pendingAssetWrites'>
  currentImageId: Readonly<Ref<string>>
  busy: Readonly<Ref<boolean>>
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 現在カードと候補が参照するPNGを逐次照合する。未表示カードの原画像は読み込まない。 */
export function useDiscoveryImageIdentity({ store, runtime, currentImageId, busy, logDiagnostic }: DiscoveryImageIdentityOptions) {
  const cache = createImageDigestCache()
  const checking = ref(false)
  const result = shallowRef<DiscoveryImageIdentity | null>(null)
  let disposed = false
  let request = 0
  let cacheGeneration = runtime.projectGeneration.value
  let resultIsCurrent: () => boolean = () => false

  /** staleな結果は、Vueの次tickを待たず取得時にも拒否する。 */
  function currentIdentity(): DiscoveryImageIdentity | null {
    return !disposed && !busy.value && resultIsCurrent() ? result.value : null
  }

  async function verifyCurrent(): Promise<DiscoveryImageIdentity | null> {
    const run = ++request
    result.value = null
    resultIsCurrent = () => false
    checking.value = false
    if (disposed || busy.value || !store.assetDiscovery?.occurrences.length)
      return null
    const state = store.assetDiscovery
    const generation = runtime.projectGeneration.value
    if (cacheGeneration !== generation) {
      cache.clear()
      cacheGeneration = generation
    }
    const cardId = currentImageId.value
    const source = runtime.cardSourceFile.value
    const files = runtime.assetFiles.value
    const writes = runtime.pendingAssetWrites.value
    const assets = store.assets
    const resourcesCurrent = () => !disposed && generation === runtime.projectGeneration.value
      && cardId === currentImageId.value && source === runtime.cardSourceFile.value
      && files === runtime.assetFiles.value && writes === runtime.pendingAssetWrites.value && assets === store.assets
    const isCurrent = () => run === request && !busy.value && resourcesCurrent() && state === store.assetDiscovery
    const imageDigests = new Map<string, string>()
    const assetDigests = new Map<string, string>()
    const errors = new Map<string, string>()
    checking.value = true
    try {
      const read = async (key: string, blob: Blob | undefined | null): Promise<string | null> => {
        if (!blob) {
          errors.set(key, '画像が未読込または取得できていないため、承認を確認できません。')
          return null
        }
        try {
          return await cache.digest(blob)
        }
        catch (error) {
          errors.set(key, error instanceof Error ? error.message : '画像の内容照合に失敗しました。')
          return null
        }
      }
      if (state.occurrences.some(occurrence => occurrence.cardId === cardId)) {
        const digest = await read(`card:${cardId}`, source)
        if (!isCurrent())
          return null
        if (digest)
          imageDigests.set(cardId, digest)
      }
      const referenced = new Set(state.occurrences.flatMap(occurrence => occurrence.assetId ? [occurrence.assetId] : []))
      for (const id of referenced) {
        if (!isCurrent())
          return null
        const digest = await read(`asset:${id}`, writes.get(id) ?? files.get(id))
        if (!isCurrent())
          return null
        if (digest)
          assetDigests.set(id, digest)
      }
      if (!isCurrent())
        return null
      const changed = store.reconcileAssetDiscoveryContent(imageDigests, assetDigests)
      if (changed)
        logDiagnostic('画像の内容変更によりアイコン候補を再確認待ちに戻しました。')
      if (errors.size)
        logDiagnostic('一部のアイコン候補は画像の同一性を確認できませんでした。', [...errors], 'error')
      const identity: DiscoveryImageIdentity = { cardId, imageDigest: imageDigests.get(cardId) ?? null, assetDigests, errors }
      result.value = identity
      resultIsCurrent = resourcesCurrent
      return identity
    }
    finally {
      if (run === request)
        checking.value = false
    }
  }

  watch(() => [busy.value, runtime.projectGeneration.value, currentImageId.value, runtime.cardSourceFile.value, runtime.assetFiles.value, runtime.pendingAssetWrites.value, store.assets, store.assetDiscovery], () => {
    void verifyCurrent().catch((error) => {
      if (!disposed)
        logDiagnostic('アイコン候補の照合状態を更新できませんでした。', error, 'error')
    })
  }, { immediate: true })

  onScopeDispose(() => {
    disposed = true
    request++
    checking.value = false
    result.value = null
    resultIsCurrent = () => false
    cache.clear()
  })

  return { checking: readonly(checking), currentIdentity, verifyCurrent }
}
