import type { Ref } from 'vue'
import type { OCRExecutionState } from '~/composables/useEditorOCR'
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { OCRProvider, RegionCandidate } from '~/services/ocr/types'
import type { FolderProjectCard, FolderProjectDocument } from '~/types/editor'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { createRegionCandidates } from '~/services/ocr/candidates'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { runSequentialOCRQueue } from '~/services/ocr/queue'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { sampleRegionCandidates } from '~/services/project/sample'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'

interface BatchOCROptions {
  provider: OCRProvider
  execution: OCRExecutionState
  projectCards: Ref<FolderProjectCard[]>
  folderDocument: Ref<FolderProjectDocument | null>
  projectDirectory: Ref<FileSystemDirectoryHandle | null>
  currentImageId: Ref<string>
  pendingCardDeletionIds: Ref<Set<string>>
  isDemo: Ref<boolean>
  selectProjectCard: (cardId: string) => Promise<void>
  showBatchOCRCandidates: (cardId: string) => boolean
  clearRegionCandidates: () => void
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 候補の履歴を独立して保存できるよう深く複製する。 */
export function cloneRegionCandidates(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    lines: candidate.lines.map(line => ({ ...line })),
  }))
}

/** カードを順に認識し、確定前の候補と進捗を管理する。 */
export function useBatchOCR({
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  projectCards,
  folderDocument,
  projectDirectory,
  currentImageId,
  pendingCardDeletionIds,
  isDemo,
  selectProjectCard,
  showBatchOCRCandidates,
  clearRegionCandidates,
  setMessage,
  logDiagnostic,
}: BatchOCROptions) {
  /** 複数カードの領域検出キューを実行中か。 */
  const batchOCRRunning = ref(false)
  /** 次のカードへ進む前に一括OCRを中止する要求。 */
  const batchOCRCancelRequested = ref(false)
  /** 画面終了後は一括OCRの次工程と遅延通知を受け付けない。 */
  let batchOCRDisposed = false
  /** 一括OCRで処理を終えたカード数。 */
  const batchOCRCompleted = ref(0)
  /** 現在の一括OCRで処理するカードの総数。 */
  const batchOCRTotal = ref(0)
  /** カードIDごとの待機・処理中・確認待ち・失敗の状態。 */
  const batchOCRStates = shallowRef(new Map<string, OCRQueueCardState>())
  /** カードIDごとに退避した確認前の領域候補。 */
  const batchOCRResults = shallowRef(new Map<string, RegionCandidate[]>())

  /** 削除予定や現在の処理状態を考慮した一括OCRの対象カード。 */
  const batchOCREligibleCards = computed(() => projectCards.value.filter((card) => {
    const state = batchOCRStates.value.get(card.id)
    return card.regions.length === 0
      && !pendingCardDeletionIds.value.has(card.id)
      && state?.status !== 'review'
      && state?.status !== 'processing'
      && state?.status !== 'queued'
  }))

  /** 一括OCRの進捗・結果・確認状態を初期化する。 */
  function resetBatchOCR() {
    batchOCRCancelRequested.value = false
    batchOCRCompleted.value = 0
    batchOCRTotal.value = 0
    batchOCRStates.value = new Map()
    batchOCRResults.value = new Map()
  }

  /** 指定カードの一括OCR状態を更新または削除する。 */
  function updateBatchOCRState(cardId: string, state: OCRQueueCardState | null) {
    const states = new Map(batchOCRStates.value)
    if (state)
      states.set(cardId, state)
    else
      states.delete(cardId)
    batchOCRStates.value = states
  }

  /** 指定カードの領域候補を一括OCR結果へ保存する。 */
  function updateBatchOCRResult(
    cardId: string,
    candidates: readonly RegionCandidate[] | null,
  ) {
    const results = new Map(batchOCRResults.value)
    if (candidates)
      results.set(cardId, cloneRegionCandidates(candidates))
    else
      results.delete(cardId)
    batchOCRResults.value = results
  }

  /** 指定カードを除き、次に確認する一括OCR結果を探す。 */
  function nextBatchOCRReviewCard(excludeCardId?: string) {
    return projectCards.value.find(card =>
      card.id !== excludeCardId
      && batchOCRStates.value.get(card.id)?.status === 'review')
  }

  /** 確認待ちのカードへ移動して領域候補を表示する。 */
  async function openBatchOCRReview(cardId: string) {
    if (batchOCRDisposed)
      return
    if (currentImageId.value !== cardId)
      await selectProjectCard(cardId)
    if (!batchOCRDisposed && currentImageId.value === cardId && showBatchOCRCandidates(cardId))
      setMessage('OCRで検出した領域候補を確認してください。')
  }

  /** カードの候補確認が済んだことを一括OCRの状態へ反映する。 */
  function finishBatchOCRReview(cardId: string) {
    updateBatchOCRResult(cardId, null)
    updateBatchOCRState(cardId, null)
    const next = nextBatchOCRReviewCard(cardId)
    if (next)
      void openBatchOCRReview(next.id)
  }

  /** 一括OCRをカード間で中止する要求を記録する。 */
  function requestBatchOCRCancellation() {
    batchOCRCancelRequested.value = true
    setMessage('現在のカードのOCR完了後に一括処理を中止します。')
  }

  /** 指定カードの画像から領域候補を作る。サンプルでは用意済みの候補を使う。 */
  async function detectCardRegionCandidates(
    directory: FileSystemDirectoryHandle,
    card: FolderProjectCard,
    index: number,
    total: number,
  ) {
    if (batchOCRDisposed)
      return []
    if (isDemo.value) {
      const candidates = sampleRegionCandidates(card)
      ocrStatus.value = `${index + 1}/${total} ${card.imageName}: デモ候補を準備しています…`
      updateBatchOCRResult(card.id, candidates.length ? candidates : null)
      return candidates
    }
    const file = await loadFolderProjectCardImage(directory, card)
    if (batchOCRDisposed)
      return []
    assertFileSize(file, FILE_LIMITS.imageBytes, `${card.imageName}`)
    const bitmap = await createImageBitmap(file)
    try {
      if (batchOCRDisposed)
        return []
      assertImageDimensions(bitmap.width, bitmap.height, `${card.imageName}`)
      const scale = 2
      const blob = await prepareRegionForOCR(
        bitmap,
        { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
        { scale, padding: 0 },
      )
      if (batchOCRDisposed)
        return []
      const result = await ocrProvider.recognize(blob, {
        language: 'eng',
        layout: 'sparse-text',
        onProgress: (progress) => {
          if (batchOCRDisposed)
            return
          ocrProgress.value = progress.progress
          ocrStatus.value = `${index + 1}/${total} ${card.imageName}: ${progress.status}`
        },
      })
      if (batchOCRDisposed)
        return []
      const candidates = createRegionCandidates(result.blocks, {
        scale,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height,
        padding: 6,
      })
      updateBatchOCRResult(card.id, candidates.length > 0 ? candidates : null)
      return candidates
    }
    finally {
      bitmap.close()
    }
  }

  /** カードごとに候補を蓄え、確認待ち・失敗・空結果を一覧へ通知する。領域への追加は確認後に行う。 */
  async function startBatchOCR() {
    const directory = projectDirectory.value
    const documentValue = folderDocument.value
    if (!directory || !documentValue || ocrRunning.value || batchOCRDisposed)
      return
    const cards = batchOCREligibleCards.value
    if (cards.length < 2) {
      setMessage('領域未作成のカードが2枚以上あるときに一括OCRを実行できます。')
      return
    }

    batchOCRCancelRequested.value = false
    batchOCRCompleted.value = 0
    const queuedStates = new Map(batchOCRStates.value)
    cards.forEach((card) => {
      queuedStates.set(card.id, { status: 'queued' })
      updateBatchOCRResult(card.id, null)
    })
    batchOCRStates.value = queuedStates
    batchOCRTotal.value = cards.length
    batchOCRRunning.value = true
    ocrRunning.value = true
    ocrProgress.value = 0
    ocrStatus.value = `1/${cards.length} OCRを初期化しています…`
    clearRegionCandidates()
    logDiagnostic('複数カードの領域候補検出を開始しました', {
      cards: cards.length,
    })

    try {
      const cardById = new Map(cards.map(card => [card.id, card]))
      const summary = await runSequentialOCRQueue(
        cards.map(card => card.id),
        async (cardId) => {
          const card = cardById.get(cardId)!
          const index = cards.findIndex(item => item.id === cardId)
          ocrProgress.value = 0
          ocrStatus.value = `${index + 1}/${cards.length} ${card.imageName}を解析しています…`
          return detectCardRegionCandidates(directory, card, index, cards.length)
        },
        {
          cancelled: () => batchOCRDisposed || batchOCRCancelRequested.value,
          onProgress: ({ cardId, index, state }) => {
            if (batchOCRDisposed)
              return
            updateBatchOCRState(cardId, state)
            if (state.status !== 'processing')
              batchOCRCompleted.value = index + 1
            if (state.status === 'error') {
              updateBatchOCRResult(cardId, null)
              logDiagnostic('カードの一括OCRに失敗しました', {
                cardId,
                error: state.message,
              }, 'error')
            }
          },
        },
      )
      if (batchOCRDisposed)
        return
      logDiagnostic('複数カードの領域候補検出が終了しました', summary)
      const result = [
        `確認待ち${summary.review}枚`,
        `候補なし${summary.empty}枚`,
        summary.errors > 0 ? `失敗${summary.errors}枚` : '',
      ].filter(Boolean).join('、')
      setMessage(
        summary.cancelled
          ? `一括OCRを中止しました（${result}）。`
          : `一括OCRが完了しました（${result}）。`,
      )
      if (summary.cancelled) {
        const remainingStates = new Map(batchOCRStates.value)
        remainingStates.forEach((state, cardId) => {
          if (state.status === 'queued')
            remainingStates.delete(cardId)
        })
        batchOCRStates.value = remainingStates
      }
    }
    finally {
      if (!batchOCRDisposed) {
        batchOCRRunning.value = false
        ocrRunning.value = false
        ocrProgress.value = null
        ocrStatus.value = ''
        const currentHasResult = batchOCRStates.value.get(currentImageId.value)
          ?.status === 'review'
        const firstReview = currentHasResult
          ? projectCards.value.find(card => card.id === currentImageId.value)
          : nextBatchOCRReviewCard()
        if (firstReview)
          await openBatchOCRReview(firstReview.id)
      }
    }
  }

  onBeforeUnmount(() => {
    batchOCRDisposed = true
    batchOCRCancelRequested.value = true
  })

  return {
    batchOCRRunning,
    batchOCRCompleted,
    batchOCRTotal,
    batchOCRStates,
    batchOCRResults,
    batchOCREligibleCards,
    resetBatchOCR,
    updateBatchOCRState,
    updateBatchOCRResult,
    finishBatchOCRReview,
    requestBatchOCRCancellation,
    startBatchOCR,
  }
}
