import type { Ref } from 'vue'
import type { useDiscoveryImageIdentity } from './useDiscoveryImageIdentity'
import type { useDiscoveryReview } from './useDiscoveryReview'
import type { useEditorAssets } from '~/composables/useEditorAssets'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import type { AssetCreationDraft, ImageAsset } from '~/types/editor'
import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue'
import { intersectionArea } from '~/services/asset-discovery/geometry'
import { containsBounds } from '~/services/asset-discovery/review'
import { activeReviewGroups } from '~/services/asset-discovery/review-groups'

interface DiscoveryAssetRegistrationOptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'assetDiscovery' | 'assets'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'cardImage' | 'cardSourceFile' | 'projectGeneration'>
  currentImageId: Readonly<Ref<string>>
  identity: Pick<ReturnType<typeof useDiscoveryImageIdentity>, 'currentIdentity'>
  review: Pick<ReturnType<typeof useDiscoveryReview>, 'linkAsset'>
  createAsset: ReturnType<typeof useEditorAssets>['createSourceIconAsset']
  busy?: () => boolean
}

export interface DiscoveryRegistrationResult {
  asset: ImageAsset
  linked: boolean
  /** PNG登録済みで、候補への関連付けだけができなかった場合。登録を自動で取り消さない。 */
  warning?: string
}

/** 代表切り抜きの登録と個別の承認を分ける。元画像・原文・マスクは変更しない。 */
export function useDiscoveryAssetRegistration({ store, runtime, currentImageId, identity, review, createAsset, busy = () => false }: DiscoveryAssetRegistrationOptions) {
  const pending = shallowRef<{ current: () => boolean, linking: boolean } | null>(null)
  let disposed = false
  function cancel() {
    pending.value = null
  }
  watchEffect(() => {
    const request = pending.value
    if (request && !request.linking && !request.current())
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancel()
  })

  async function register(
    occurrenceId: string,
    draft: AssetCreationDraft,
    options: { groupId?: string, linkGroupMembers?: boolean, isCurrent?: () => boolean } = {},
  ): Promise<DiscoveryRegistrationResult | null> {
    if (disposed || busy() || pending.value)
      return null
    const state = store.assetDiscovery
    const occurrence = state?.occurrences.find(item => item.id === occurrenceId)
    const source = runtime.cardImage.value
    const file = runtime.cardSourceFile.value
    const generation = runtime.projectGeneration.value
    const cardId = currentImageId.value
    const verified = identity.currentIdentity()
    if (!occurrence || !source || !file || occurrence.cardId !== cardId || verified?.cardId !== cardId
      || verified.imageDigest !== occurrence.imageDigest || source.naturalWidth !== occurrence.imageSize.width || source.naturalHeight !== occurrence.imageSize.height) {
      throw new Error('候補の元画像を開き、内容の照合が完了してから登録してください。')
    }
    if (occurrence.decision === 'excluded')
      throw new Error('除外した候補は未確認に戻してから登録してください。')
    const groupId = options.groupId
    if (options.linkGroupMembers && !groupId)
      throw new Error('登録するグループを選んでください。')
    if (groupId && activeReviewGroups(state!).find(group => group.id === groupId)?.representativeId !== occurrenceId)
      throw new Error('グループの代表候補を選び直してください。')
    if (draft.editingAssetId !== null || !containsBounds({ x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight }, draft.sourceRect)
      || intersectionArea(draft.sourceRect, occurrence.bounds) === 0) {
      throw new Error('登録する代表切り抜きの範囲を候補付近で確認してください。')
    }
    const draftText = JSON.stringify(draft)
    const snapshot = JSON.parse(draftText) as AssetCreationDraft
    const stateText = JSON.stringify(state)
    const request: { linking: boolean, current: () => boolean } = {
      linking: false,
      current: () => !disposed && !busy() && pending.value === request
        && generation === runtime.projectGeneration.value && cardId === currentImageId.value
        && source === runtime.cardImage.value && file === runtime.cardSourceFile.value
        && state === store.assetDiscovery && stateText === JSON.stringify(store.assetDiscovery)
        && draftText === JSON.stringify(draft) && (options.isCurrent?.() ?? true),
    }
    pending.value = request
    try {
      const asset = await createAsset(snapshot, source, cardId, request.current)
      if (!asset)
        return null
      if (generation !== runtime.projectGeneration.value || !store.assets.some(item => item.id === asset.id))
        return null
      if (!request.current())
        return { asset, linked: false, warning: 'アイコンは登録済みですが、対象が変わったため候補への関連付けはしていません。' }
      request.linking = true
      try {
        // グループUIでは全メンバーへ同じ登録先を反映する。個別の承認はしない。
        const ids = options.linkGroupMembers ? state!.groups.find(group => group.id === groupId)!.memberIds : [occurrenceId]
        review.linkAsset(ids, asset.id, groupId)
        return { asset, linked: true }
      }
      catch (error) {
        return { asset, linked: false, warning: `アイコンは登録済みです。候補への関連付けを確認してください。${error instanceof Error ? error.message : String(error)}` }
      }
    }
    catch (error) {
      if (!request.current())
        return null
      throw error
    }
    finally {
      if (pending.value === request)
        pending.value = null
    }
  }

  return { running: computed(() => pending.value !== null), register, cancel }
}
