import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { OCRExecutionState } from '~/composables/useEditorOCR'
import type { OCRProvider, RegionCandidate } from '~/services/ocr/types'
import type { RegionDraft } from '~/types/editor'
import { onBeforeUnmount, ref } from 'vue'
import { cloneRegionCandidates, createRegionCandidates, splitRegionCandidate } from '~/services/ocr/candidates'
import { prepareRegionForOCR } from '~/services/ocr/image'

interface RegionCandidatesOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegionId'>
  image: Ref<HTMLImageElement | null>
  provider: OCRProvider
  execution: OCRExecutionState
  isDemo: Ref<boolean>
  cardPreviewMode: Ref<'edited' | 'original'>
  clearOCRCandidate: () => void
  persistDisplayedBatchCandidates: () => void
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 認識候補の検出・選択・移動・分割を、確定済み領域とは独立した履歴で管理する。 */
export function useRegionCandidates({
  editor,
  image,
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  isDemo,
  cardPreviewMode,
  clearOCRCandidate,
  persistDisplayedBatchCandidates,
  setMessage,
  logDiagnostic,
}: RegionCandidatesOptions) {
  /** 現在のカードで確認・調整している領域候補。 */
  const regionCandidates = ref<RegionCandidate[]>([])
  let regionDetectionDisposed = false
  /** 移動や分割の操作対象として選択中の領域候補ID。 */
  const selectedCandidateId = ref<string | null>(null)
  /** 領域候補の位置変更や分割を戻すための履歴。 */
  const regionCandidateEditHistory = ref<RegionCandidate[][]>([])

  /** 現在表示している領域候補と選択・編集履歴を消す。 */
  function clearRegionCandidates() {
    regionCandidates.value = []
    selectedCandidateId.value = null
    regionCandidateEditHistory.value = []
    cardPreviewMode.value = 'edited'
  }

  /** 位置調整する領域候補を選択する。 */
  function selectRegionCandidate(id: string | null) {
    selectedCandidateId.value = id
    logDiagnostic(
      id
        ? '領域候補へフォーカスしました'
        : '領域候補のフォーカスを解除しました',
      id ? { candidateId: id } : undefined,
    )
  }

  /** 領域候補を追加対象に含めるか切り替える。 */
  function toggleRegionCandidate(id: string) {
    const candidate = regionCandidates.value.find(item => item.id === id)
    if (!candidate)
      return
    regionCandidates.value = regionCandidates.value.map(candidate =>
      candidate.id === id
        ? { ...candidate, selected: !candidate.selected }
        : candidate,
    )
    logDiagnostic('領域候補の追加対象を切り替えました', {
      candidateId: id,
      selected: !candidate.selected,
    })
    persistDisplayedBatchCandidates()
  }

  /** 表示している領域候補の選択状態をまとめて変更する。 */
  function selectAllRegionCandidates(selected: boolean) {
    regionCandidates.value = regionCandidates.value.map(candidate => ({
      ...candidate,
      selected,
    }))
    logDiagnostic('領域候補の追加対象を一括変更しました', {
      selected,
      candidates: regionCandidates.value.length,
    })
    persistDisplayedBatchCandidates()
  }

  /** 選んだOCR候補を認識済みの行に基づいて分割する。 */
  function splitCandidate(id: string) {
    const index = regionCandidates.value.findIndex(candidate => candidate.id === id)
    if (index < 0)
      return
    const parts = splitRegionCandidate(regionCandidates.value[index]!)
    if (!parts)
      return
    regionCandidateEditHistory.value = [
      ...regionCandidateEditHistory.value,
      cloneRegionCandidates(regionCandidates.value),
    ].slice(-20)
    regionCandidates.value = regionCandidates.value.toSpliced(index, 1, ...parts)
    selectedCandidateId.value = parts[0].id
    logDiagnostic('領域候補を上下に分割しました', {
      candidateId: id,
      parts: parts.map(part => part.id),
      history: regionCandidateEditHistory.value.length,
    })
    setMessage('領域候補を上下2つに分割しました。')
    persistDisplayedBatchCandidates()
  }

  /** 候補の範囲変更を記録し、確認用の座標を更新する。 */
  function updateCandidateBounds(id: string, bounds: RegionDraft) {
    const candidate = regionCandidates.value.find(item => item.id === id)
    if (!candidate)
      return
    regionCandidateEditHistory.value = [
      ...regionCandidateEditHistory.value,
      cloneRegionCandidates(regionCandidates.value),
    ].slice(-20)
    const scaleX = bounds.width / Math.max(1, candidate.width)
    const scaleY = bounds.height / Math.max(1, candidate.height)
    regionCandidates.value = regionCandidates.value.map(item =>
      item.id === id
        ? {
            ...item,
            ...bounds,
            lines: item.lines.map(line => ({
              ...line,
              x: bounds.x + (line.x - candidate.x) * scaleX,
              y: bounds.y + (line.y - candidate.y) * scaleY,
              width: line.width * scaleX,
              height: line.height * scaleY,
            })),
          }
        : item,
    )
    logDiagnostic('領域候補の範囲を変更しました', {
      candidateId: id,
      before: {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
      },
      after: bounds,
      history: regionCandidateEditHistory.value.length,
    })
    persistDisplayedBatchCandidates()
  }

  /** 領域候補に対する直前の位置変更や分割を戻す。 */
  function undoCandidateChange() {
    const previous = regionCandidateEditHistory.value.at(-1)
    if (!previous)
      return
    regionCandidates.value = previous
    regionCandidateEditHistory.value = regionCandidateEditHistory.value.slice(0, -1)
    if (
      selectedCandidateId.value
      && !previous.some(candidate => candidate.id === selectedCandidateId.value)
    ) {
      selectedCandidateId.value = null
    }
    logDiagnostic('領域候補の変更を戻しました', {
      candidates: previous.length,
      remainingHistory: regionCandidateEditHistory.value.length,
    })
    setMessage('直前の候補変更を戻しました。')
    persistDisplayedBatchCandidates()
  }

  /** 現在のカード画像をOCRし、確認用の領域候補を作る。 */
  async function detectRegionCandidates() {
    const source = image.value
    const project = editor.project.value
    if (!source || ocrRunning.value || regionDetectionDisposed)
      return
    if (isDemo.value)
      return
    const startedAt = performance.now()
    ocrRunning.value = true
    ocrProgress.value = 0
    ocrStatus.value = '画像全体のOCRを初期化しています…'
    cardPreviewMode.value = 'original'
    editor.selectedRegionId.value = null
    clearOCRCandidate()
    regionCandidates.value = []
    selectedCandidateId.value = null
    regionCandidateEditHistory.value = []
    logDiagnostic('画像全体の領域候補検出を開始しました', {
      width: project.imageWidth,
      height: project.imageHeight,
      scale: 2,
    })
    try {
      const scale = 2
      const blob = await prepareRegionForOCR(
        source,
        {
          x: 0,
          y: 0,
          width: project.imageWidth,
          height: project.imageHeight,
        },
        { scale, padding: 0 },
      )
      if (regionDetectionDisposed)
        return
      const result = await ocrProvider.recognize(blob, {
        language: 'eng',
        layout: 'sparse-text',
        onProgress: (progress) => {
          if (regionDetectionDisposed)
            return
          ocrProgress.value = progress.progress
          ocrStatus.value = progress.status
        },
      })
      if (regionDetectionDisposed)
        return
      regionCandidates.value = createRegionCandidates(result.blocks, {
        scale,
        imageWidth: project.imageWidth,
        imageHeight: project.imageHeight,
        padding: 6,
      })
      logDiagnostic('画像全体の領域候補検出が完了しました', {
        detectedLines: result.blocks.length,
        candidates: regionCandidates.value.length,
        durationMs: Math.round(performance.now() - startedAt),
      })
      if (regionCandidates.value.length === 0) {
        cardPreviewMode.value = 'edited'
        setMessage('領域候補を検出できませんでした。')
      }
      else {
        setMessage(`${regionCandidates.value.length}件の領域候補を検出しました。`)
      }
    }
    catch (error) {
      if (regionDetectionDisposed)
        return
      clearRegionCandidates()
      logDiagnostic('領域候補の検出に失敗しました', error, 'error')
      setMessage('領域候補を検出できませんでした。診断ログを確認してください。')
    }
    finally {
      if (!regionDetectionDisposed) {
        ocrRunning.value = false
        ocrProgress.value = null
        ocrStatus.value = ''
      }
    }
  }

  onBeforeUnmount(() => {
    regionDetectionDisposed = true
  })

  return {
    regionCandidates,
    selectedCandidateId,
    regionCandidateEditHistory,
    clearRegionCandidates,
    selectRegionCandidate,
    toggleRegionCandidate,
    selectAllRegionCandidates,
    splitCandidate,
    updateCandidateBounds,
    undoCandidateChange,
    detectRegionCandidates,
  }
}
