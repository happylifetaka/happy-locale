import type { useCardEditor } from '~/composables/useCardEditor'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { RegionProposalChoice, RegionProposalReview, RegionProposalScope, RegionReviewCard } from '~/services/asset-discovery/region-proposal'
import type { RegionCandidate } from '~/types/ocr'
import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { adoptRegionProposal, compareRegionProposal } from '~/services/asset-discovery/region-proposal'

export interface RegionDetectionReviewTarget {
  card: RegionReviewCard
  /** 初回保存前だけnull。通常領域エディターが現在所有するカードID。 */
  editorCardId: string | null
}

export interface RegionDetectionReviewRequest {
  cardId: string
  file: File
  imageWidth: number
  imageHeight: number
  imageDigest: string
  isCurrent: () => boolean
}

interface RegionDetectionReviewOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'applyRegionDetection'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'projectGeneration' | 'cardSourceFile'>
  target: () => RegionDetectionReviewTarget | null
  /** 元画像から新しく解析する入口。結果をStoreや表示中候補へ先に反映しない。 */
  detect: (request: RegionDetectionReviewRequest) => Promise<readonly RegionCandidate[] | null>
  /** 画像インスタンス・検出設定・照合アセットの版など、追加の依存先。 */
  scope?: () => readonly unknown[]
  /** 保存・カード切替等の外部処理。自身のrunningは含めない。 */
  busy?: () => boolean
}

function snapshot(target: RegionDetectionReviewTarget | null): string {
  if (!target)
    return 'null'
  const { card } = target
  return JSON.stringify([target.editorCardId, card.id, card.imageWidth, card.imageHeight, card.regions, card.ocrCandidates ?? []])
}

/** 再検出を一時的な差分へ変換し、明示選択だけを通常の混在編集・Undoへ渡す。 */
export function useRegionDetectionReview({ editor, runtime, target, detect, scope = () => [], busy = () => false }: RegionDetectionReviewOptions) {
  const active = shallowRef<{ current: () => boolean, scope: RegionProposalScope | null } | null>(null)
  const result = shallowRef<RegionProposalReview | null>(null)
  const running = shallowRef(false)
  const digests = createImageDigestCache()
  let revision = 0
  let disposed = false

  function cancel() {
    revision++
    active.value = null
    result.value = null
    running.value = false
  }

  // 編集→Undo、カード／画像変更→復元でも、古い結果を同じtick内に復活させない。
  watchEffect(() => {
    if (active.value && !active.value.current())
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancel()
    digests.clear()
  })

  async function analyze(): Promise<RegionProposalReview | null> {
    if (disposed || busy() || running.value)
      return null
    cancel()
    const start = target()
    if (!start)
      return null
    if (start.editorCardId !== null && start.editorCardId !== start.card.id)
      throw new Error('比較対象のカードと編集対象が一致していません。')
    const file = runtime.cardSourceFile.value
    if (!file)
      throw new Error('元画像を読み込んでから再検出してください。')
    const originalProject = editor.project.value
    if (originalProject.imageWidth !== start.card.imageWidth || originalProject.imageHeight !== start.card.imageHeight
      || JSON.stringify(originalProject.regions) !== JSON.stringify(start.card.regions)) {
      throw new Error('領域の編集状態が保存用データと異なります。再比較してください。')
    }
    const initial = snapshot(start)
    const card = JSON.parse(JSON.stringify(start.card)) as RegionReviewCard
    const generation = runtime.projectGeneration.value
    const dependencies = [...scope()]
    const requestRevision = revision
    let invalidated = false
    const request = {
      scope: null as RegionProposalScope | null,
      current: () => {
        const currentDependencies = scope()
        invalidated ||= disposed || busy() || active.value !== request || revision !== requestRevision
          || file !== runtime.cardSourceFile.value || generation !== runtime.projectGeneration.value
          || editor.project.value !== originalProject || initial !== snapshot(target())
          || dependencies.length !== currentDependencies.length || dependencies.some((value, index) => value !== currentDependencies[index])
        return !invalidated
      },
    }
    active.value = request
    running.value = true
    try {
      const imageDigest = await digests.digest(file)
      if (!request.current())
        return null
      request.scope = { session: Symbol('region-review'), imageDigest, revision: requestRevision }
      const candidates = await detect({ cardId: card.id, file, imageWidth: card.imageWidth, imageHeight: card.imageHeight, imageDigest, isCurrent: request.current })
      if (!candidates || !request.current())
        return null
      const review = compareRegionProposal(card, { cardId: card.id, imageDigest, imageWidth: card.imageWidth, imageHeight: card.imageHeight, candidates }, request.scope)
      result.value = review
      return review
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

  function apply(review: RegionProposalReview, choices: readonly RegionProposalChoice[]) {
    const request = active.value
    const current = target()
    if (!current || !request?.current() || !request.scope || running.value || result.value !== review)
      throw new Error('領域の比較結果が古いか対象が変わりました。再検出してください。')
    const card = JSON.parse(JSON.stringify(current.card)) as RegionReviewCard
    const next = adoptRegionProposal(card, review, choices, request.scope)
    if (!choices.length)
      return
    const changedIds = new Set(choices.flatMap(choice => choice.action === 'bounds' && choice.target.kind === 'region' ? [choice.target.id] : []))
    editor.applyRegionDetection(
      next.regions.filter(region => changedIds.has(region.id)).map(region => ({ id: region.id, bounds: { x: region.x, y: region.y, width: region.width, height: region.height } })),
      card.ocrCandidates ?? [],
      next.ocrCandidates ?? [],
      current.editorCardId,
    )
    cancel()
  }

  return {
    running: computed(() => running.value),
    review: computed(() => active.value?.current() ? result.value : null),
    analyze,
    apply,
    cancel,
  }
}
