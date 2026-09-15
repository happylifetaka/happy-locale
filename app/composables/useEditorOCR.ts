import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { OCRCorrectionChange } from '~/services/ocr/correction-types'
import type { OCRLayout, OCRProvider } from '~/services/ocr/types'
import type { ImageAsset, OCRDictionaryEntry } from '~/types/editor'
import { computed, ref, shallowRef } from 'vue'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { LocalOCRCorrector } from '~/services/ocr/local-corrector'
import { regionTextLayout } from '~/utils/region-text-layout'
import { sourceIconProblems, textWithSourceIcons } from '~/utils/source-icons'

/** 単一領域・全体検出・一括OCRが共有する実行状態。 */
export interface OCRExecutionState {
  running: Ref<boolean>
  progress: Ref<number | null>
  status: Ref<string>
}

interface EditorOCROptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegion' | 'selectedRegionId' | 'updateRegion'>
  provider: OCRProvider
  execution: OCRExecutionState
  image: Ref<HTMLImageElement | null>
  currentImageId: Ref<string>
  assets: Ref<ImageAsset[]>
  ocrDictionary: Ref<OCRDictionaryEntry[]>
  setOCRDictionary: (entries: OCRDictionaryEntry[]) => void
  cardPreviewMode: Ref<'edited' | 'original'>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 選択領域のOCR候補と辞書補正を管理し、確定時だけ編集履歴へ反映する。 */
export function useEditorOCR({
  editor,
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  image,
  currentImageId,
  assets,
  ocrDictionary,
  setOCRDictionary,
  cardPreviewMode,
  setMessage,
  logDiagnostic,
}: EditorOCROptions) {
  const ocrCorrector = new LocalOCRCorrector()
  /** 領域未選択時に使用するOCRの読み取りモード。 */
  const defaultOCRLayout = ref<OCRLayout>('text-block')
  /** 選択領域のOCRモード。未選択時は共通の初期値を使用する。 */
  const ocrLayout = computed<OCRLayout>({
    get: () => editor.selectedRegion.value ? regionTextLayout(editor.selectedRegion.value) : defaultOCRLayout.value,
    set: (layout) => {
      if (editor.selectedRegion.value)
        editor.updateRegion(editor.selectedRegion.value.id, { ocrLayout: layout })
      else
        defaultOCRLayout.value = layout
    },
  })
  /** 認識後、原文への反映を待っているOCR結果。 */
  const ocrCandidate = ref('')
  /** 現在のOCR結果の信頼度。値がなければnull。 */
  const ocrConfidence = ref<number | null>(null)
  /** OCR候補を取得した対象領域のID。 */
  const ocrCandidateRegionId = ref<string | null>(null)
  /** OCR開始時のカードIDと内容の照合情報。 */
  const ocrCandidateSource = shallowRef<{ cardId: string, signature: string } | null>(null)
  /** ローカル補正後の原文候補。 */
  const ocrCorrectionCandidate = ref('')
  /** 辞書や文字補正により提案された変更箇所。 */
  const ocrCorrectionChanges = ref<OCRCorrectionChange[]>([])
  /** OCR候補と信頼度・対象情報・補正候補を解除する。 */
  function clearOCRCandidate() {
    ocrCandidate.value = ''
    ocrConfidence.value = null
    ocrCandidateRegionId.value = null
    ocrCandidateSource.value = null
    clearOCRCorrection()
  }

  /** ローカル補正の候補と変更箇所を解除する。 */
  function clearOCRCorrection() {
    ocrCorrectionCandidate.value = ''
    ocrCorrectionChanges.value = []
  }

  /** OCRの確認用原文を更新し、古い補正候補を破棄する。 */
  function updateOCRCandidate(text: string) {
    ocrCandidate.value = text
    clearOCRCorrection()
  }

  /** 補正候補をOCRの確認用原文に採用する。 */
  function applyOCRCorrection() {
    if (!ocrCorrectionCandidate.value)
      return
    ocrCandidate.value = ocrCorrectionCandidate.value
    logDiagnostic('OCR補正候補を認識候補へ採用しました', {
      changes: ocrCorrectionChanges.value.length,
    })
    clearOCRCorrection()
  }

  /** 提案されたOCR補正を破棄する。 */
  function discardOCRCorrection() {
    logDiagnostic('OCR補正候補を破棄しました', {
      changes: ocrCorrectionChanges.value.length,
    })
    clearOCRCorrection()
  }

  /** 現在のOCR候補へ辞書とローカル補正を適用し直す。 */
  async function refreshOCRCorrection() {
    clearOCRCorrection()
    if (!ocrCandidate.value)
      return
    const correction = await ocrCorrector.correct(
      ocrCandidate.value,
      ocrDictionary.value,
    )
    if (correction.changes.length === 0)
      return
    ocrCorrectionCandidate.value = correction.correctedText
    ocrCorrectionChanges.value = correction.changes
  }

  /** 検証した置換規則をOCR補正辞書へ追加する。 */
  async function addOCRDictionaryEntry(source: string, replacement: string) {
    const normalizedSource = source.trim()
    const normalizedReplacement = replacement.trim()
    if (!normalizedSource || !normalizedReplacement)
      return
    const existing = ocrDictionary.value.find(
      entry => entry.source.toLowerCase() === normalizedSource.toLowerCase(),
    )
    if (existing) {
      setOCRDictionary(ocrDictionary.value.map(entry =>
        entry.id === existing.id
          ? { ...entry, replacement: normalizedReplacement }
          : entry))
    }
    else {
      setOCRDictionary([
        ...ocrDictionary.value,
        {
          id: crypto.randomUUID(),
          source: normalizedSource,
          replacement: normalizedReplacement,
        },
      ])
    }
    logDiagnostic('OCRユーザー辞書を更新しました', {
      entries: ocrDictionary.value.length,
    })
    await refreshOCRCorrection()
  }

  /** 指定した補正規則を削除し、候補へ再適用する。 */
  async function removeOCRDictionaryEntry(id: string) {
    setOCRDictionary(
      ocrDictionary.value.filter(entry => entry.id !== id),
    )
    logDiagnostic('OCRユーザー辞書から項目を削除しました', {
      entries: ocrDictionary.value.length,
    })
    await refreshOCRCorrection()
  }

  /** OCR候補の確認を終え、関連する一時状態を消す。 */
  function finishOCRCandidate() {
    clearOCRCandidate()
    cardPreviewMode.value = 'edited'
  }

  /** 原文領域をOCR用に加工し、指定アイコンの位置を本文へ戻してから確認用の原文候補を作る。 */
  async function recognizeSelectedRegion() {
    const region = editor.selectedRegion.value
    const source = image.value
    if (!region || !source || ocrRunning.value)
      return
    const iconProblems = sourceIconProblems(region, assets.value)
    if (iconProblems.length) {
      setMessage(iconProblems.join('\n'))
      return
    }

    const targetRegionId = region.id
    const targetCardId = currentImageId.value
    const targetSignature = JSON.stringify(region)
    const assetSnapshot = assets.value
    cardPreviewMode.value = 'original'
    ocrRunning.value = true
    ocrProgress.value = 0
    ocrStatus.value = 'OCRを初期化しています…'
    clearOCRCandidate()
    logDiagnostic('選択領域のOCRを開始しました', {
      regionId: region.regionId,
      width: region.width,
      height: region.height,
    })
    try {
      const blob = await prepareRegionForOCR(source, region, {
        exclusions: [...region.exclusionAreas, ...(region.sourceIcons ?? [])],
        scale: 3,
      })
      const result = await ocrProvider.recognize(blob, {
        language: 'eng',
        layout: ocrLayout.value,
        onProgress: (progress) => {
          ocrProgress.value = progress.progress
          ocrStatus.value = progress.status
        },
      })
      if (editor.selectedRegionId.value !== targetRegionId || currentImageId.value !== targetCardId
        || JSON.stringify(editor.selectedRegion.value) !== targetSignature || assets.value !== assetSnapshot) {
        setMessage('認識中に対象が変更されたため、OCR候補を破棄しました。')
        return
      }
      const recognizedText = textWithSourceIcons(result, region.sourceIcons ?? [], assets.value)
      ocrCandidate.value = recognizedText
      ocrConfidence.value = result.confidence
      ocrCandidateRegionId.value = targetRegionId
      ocrCandidateSource.value = { cardId: targetCardId, signature: targetSignature }
      if (recognizedText) {
        const correction = await ocrCorrector.correct(
          recognizedText,
          ocrDictionary.value,
        )
        if (correction.changes.length > 0) {
          ocrCorrectionCandidate.value = correction.correctedText
          ocrCorrectionChanges.value = correction.changes
          logDiagnostic('OCR補正候補を生成しました', {
            changes: correction.changes.length,
            characters: correction.correctedText.length,
          })
        }
        else {
          logDiagnostic('OCR補正候補はありませんでした')
        }
      }
      if (!recognizedText) {
        cardPreviewMode.value = 'edited'
        setMessage('文字を認識できませんでした。領域やレイアウトを調整してください。')
      }
      logDiagnostic('選択領域のOCRが完了しました', {
        confidence: result.confidence,
        blocks: result.blocks.length,
        characters: result.text.length,
      })
    }
    catch (error) {
      cardPreviewMode.value = 'edited'
      logDiagnostic('選択領域のOCRに失敗しました', error, 'error')
      setMessage(error instanceof Error ? error.message : 'OCRに失敗しました。診断ログを確認してください。')
    }
    finally {
      ocrRunning.value = false
      ocrProgress.value = null
      ocrStatus.value = ''
    }
  }

  /** 対象の整合性を確認してOCR候補を領域の原文へ反映する。 */
  function applyOCRCandidate() {
    const regionId = ocrCandidateRegionId.value
    if (!regionId || !ocrCandidate.value.trim())
      return
    const region = editor.project.value.regions.find(item => item.id === regionId)
    if (ocrCandidateSource.value?.cardId !== currentImageId.value
      || ocrCandidateSource.value.signature !== JSON.stringify(region)) {
      clearOCRCandidate()
      setMessage('領域が変更されたため、OCR候補を反映しませんでした。認識し直してください。')
      return
    }
    editor.updateRegion(regionId, { originalText: ocrCandidate.value.trim() })
    finishOCRCandidate()
    setMessage('OCR候補を元テキストへ反映しました。')
  }

  return {
    ocrLayout,
    ocrCandidate,
    ocrConfidence,
    ocrCorrectionCandidate,
    ocrCorrectionChanges,
    clearOCRCandidate,
    updateOCRCandidate,
    applyOCRCorrection,
    discardOCRCorrection,
    addOCRDictionaryEntry,
    removeOCRDictionaryEntry,
    finishOCRCandidate,
    recognizeSelectedRegion,
    applyOCRCandidate,
  }
}
