import type { Ref } from 'vue'
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { FolderProjectCard, RegionDraft, TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { watch } from 'vue'
import { regionCandidatesSignature } from '~/services/ocr/candidate-edits'
import { cloneRegionCandidates } from '~/services/ocr/candidates'
import { resolveSampleCandidates } from '~/services/project/sample'

interface CandidateReviewOptions {
  currentImageId: Readonly<Ref<string>>
  activeProjectCard: Readonly<Ref<FolderProjectCard | null>>
  regionCandidates: Ref<RegionCandidate[]>
  selectedCandidateId: Ref<string | null>
  regionCandidateEditHistory: Ref<RegionCandidate[][]>
  cardPreviewMode: Ref<'edited' | 'original'>
  batchOCRResults: Readonly<Ref<ReadonlyMap<string, RegionCandidate[]>>>
  batchOCRStates: Readonly<Ref<ReadonlyMap<string, OCRQueueCardState>>>
  editor: {
    selectedRegionId: Ref<string | null>
    addRegions: (drafts: { bounds: RegionDraft, backgroundColor: string, originalText: string }[]) => string[]
    appendTemplateRegions: (regions: readonly TextRegion[]) => void
  }
  updateBatchOCRResult: (cardId: string, candidates: readonly RegionCandidate[] | null) => void
  finishBatchOCRReview: (cardId: string) => void
  clearRegionCandidates: () => void
  promoteDiscoveryOwners: (cardId: string, promotedIds: ReadonlyMap<string, string>) => void
  switchInspectorTab: (tab: 'ocr' | 'text') => void
  backgroundColorForBounds: (bounds: RegionDraft) => string
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown) => void
}

/** 候補の作業コピーと保存先をつなぐ操作。Worker・Canvas・保存I/Oは所有しない。 */
export function useCandidateReview({
  currentImageId,
  activeProjectCard,
  regionCandidates,
  selectedCandidateId,
  regionCandidateEditHistory,
  cardPreviewMode,
  batchOCRResults,
  batchOCRStates,
  editor,
  updateBatchOCRResult,
  finishBatchOCRReview,
  clearRegionCandidates,
  promoteDiscoveryOwners,
  switchInspectorTab,
  backgroundColorForBounds,
  setMessage,
  logDiagnostic,
}: CandidateReviewOptions) {
  let publishingCandidates: { cardId: string, signature: string } | null = null

  // 通常Undo・再検出の混在適用など、保存側で変更された候補を作業コピーへ戻す。
  // 自分のドラッグ／分割の保存通知では、今作った候補編集履歴を消さない。
  watch([() => currentImageId.value, () => regionCandidatesSignature(batchOCRResults.value.get(currentImageId.value) ?? [])], ([cardId, signature], [previousCardId]) => {
    if (cardId === previousCardId && publishingCandidates?.cardId === cardId && publishingCandidates.signature === signature)
      return
    const candidates = cloneRegionCandidates(batchOCRResults.value.get(cardId) ?? [])
    regionCandidates.value = candidates
    regionCandidateEditHistory.value = []
    if (cardId !== previousCardId || !candidates.some(candidate => candidate.id === selectedCandidateId.value))
      selectedCandidateId.value = null
  }, { flush: 'sync' })

  /** 調整中の候補と選択状態をカード別に退避し、別カードの確認から戻れるようにする。 */
  function persistDisplayedBatchCandidates() {
    publishingCandidates = { cardId: currentImageId.value, signature: regionCandidatesSignature(regionCandidates.value) }
    try {
      updateBatchOCRResult(currentImageId.value, regionCandidates.value)
    }
    finally {
      publishingCandidates = null
    }
  }

  /** 指定カードに退避した領域候補を確認画面へ戻す。 */
  function showBatchOCRCandidates(cardId: string) {
    if (cardId !== currentImageId.value)
      return false
    const candidates = batchOCRResults.value.get(cardId)
    if (!candidates)
      return false
    regionCandidates.value = cloneRegionCandidates(candidates)
    selectedCandidateId.value = null
    regionCandidateEditHistory.value = []
    editor.selectedRegionId.value = null
    cardPreviewMode.value = 'original'
    switchInspectorTab('ocr')
    return true
  }

  /** 領域候補を追加せず破棄し、一括OCRの確認状態を進める。 */
  function discardRegionCandidates() {
    const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status
      === 'review'
      ? currentImageId.value
      : null
    logDiagnostic('領域候補を破棄しました', {
      candidates: regionCandidates.value.length,
      selected: regionCandidates.value.filter(candidate => candidate.selected)
        .length,
      history: regionCandidateEditHistory.value.length,
    })
    clearRegionCandidates()
    if (reviewedCardId)
      finishBatchOCRReview(reviewedCardId)
  }

  /** 選んだ候補だけを編集領域へ確定する。サンプルでは用意済みの原文と設定を対応付ける。 */
  function confirmRegionCandidates() {
    const selected = regionCandidates.value.filter(candidate => candidate.selected)
    if (selected.length === 0) {
      setMessage('追加する領域候補を選択してください。')
      return
    }
    let sampleCandidates: TextRegion[] | null = null
    try {
      if (activeProjectCard.value)
        sampleCandidates = resolveSampleCandidates(activeProjectCard.value, selected)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'デモ候補を表示し直してください。')
      return
    }
    if (sampleCandidates) {
      const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status === 'review' ? currentImageId.value : null
      editor.appendTemplateRegions(sampleCandidates)
      clearRegionCandidates()
      switchInspectorTab('text')
      setMessage('原文・アイコン・ルビ設定を追加しました。「未翻訳をまとめて取得」で日本語訳を一括確認できます。')
      if (reviewedCardId)
        finishBatchOCRReview(reviewedCardId)
      return
    }
    const regionIds = editor.addRegions(
      selected.map(candidate => ({
        bounds: {
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height,
        },
        backgroundColor:
          backgroundColorForBounds(candidate),
        originalText: candidate.text,
      })),
    )
    const promotedIds = new Map(selected.map((candidate, index) => [candidate.id, regionIds[index]!]))
    promoteDiscoveryOwners(currentImageId.value, promotedIds)
    const count = selected.length
    const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status
      === 'review'
      ? currentImageId.value
      : null
    logDiagnostic('領域候補を通常領域へ追加しました', {
      added: count,
      discarded: regionCandidates.value.length - count,
      history: regionCandidateEditHistory.value.length,
    })
    clearRegionCandidates()
    setMessage(`${count}件の領域を追加しました。`)
    if (reviewedCardId)
      finishBatchOCRReview(reviewedCardId)
  }

  return { persistDisplayedBatchCandidates, showBatchOCRCandidates, discardRegionCandidates, confirmRegionCandidates }
}
