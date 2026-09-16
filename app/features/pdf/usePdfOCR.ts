import type { Ref } from 'vue'
import type { PdfAnalysis, PdfProtectedArea } from '~/services/pdf'
import { onScopeDispose, readonly, ref } from 'vue'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { TesseractOCRProvider } from '~/services/ocr/tesseract'
import { addPdfOcrEntry, pdfProcessingErrorMessage } from '~/services/pdf'

interface PdfOCROptions {
  analysis: Ref<PdfAnalysis | null>
  pageNumber: Readonly<Ref<number>>
  image: Readonly<Ref<HTMLImageElement | null>>
  baseURL: string
  onApplied: (entryId: string) => void
  setMessage: (message: string) => void
}

/** OCR実行状態とWorkerを所有し、同じ文書・ページが有効な間だけ結果を採用する。 */
export function usePdfOCR({ analysis, pageNumber: previewPageNumber, image: previewImage, baseURL, onApplied, setMessage }: PdfOCROptions) {
  /** OCR処理を実行しているか。 */
  const ocrRunning = ref(false)
  /** OCRエンジンから通知された進捗値。 */
  const ocrProgress = ref(0)
  /** OCRエンジンが現在実行している処理の説明。 */
  const ocrStatus = ref('')
  /** ブラウザ内で英語OCRを実行するWorkerの管理窓口。 */
  const ocrProvider = new TesseractOCRProvider(baseURL)
  /** スコープ終了後の要求・進捗・結果を無効にする。 */
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    ocrRunning.value = false
    ocrStatus.value = ''
    void ocrProvider.dispose?.().catch(() => undefined)
  })

  /** 画像PDFの指定範囲をOCRし、文字抽出で得た項目と同じ編集一覧へ追加する。 */
  async function addOcrArea(area: PdfProtectedArea) {
    const current = analysis.value
    const page = current?.pages[previewPageNumber.value - 1]
    const image = previewImage.value
    if (disposed || !current || !page || !image || ocrRunning.value)
      return
    const isCurrent = () => !disposed && analysis.value === current && previewPageNumber.value === page.pageNumber
    ocrRunning.value = true
    ocrProgress.value = 0
    ocrStatus.value = 'OCRを初期化しています…'
    try {
      const rasterScale = image.naturalWidth / page.width
      const blob = await prepareRegionForOCR(image, {
        x: area.x * rasterScale,
        y: area.y * rasterScale,
        width: area.width * rasterScale,
        height: area.height * rasterScale,
      }, { scale: 2, padding: 8 })
      if (!isCurrent())
        return
      const result = await ocrProvider.recognize(blob, {
        language: 'eng',
        layout: 'text-block',
        onProgress: (progress) => {
          if (!isCurrent())
            return
          ocrProgress.value = progress.progress
          ocrStatus.value = progress.status
        },
      })
      if (!isCurrent())
        return
      const added = addPdfOcrEntry(current, page.pageNumber, area, result.text)
      analysis.value = added.analysis
      onApplied(added.entry.id)
      setMessage(`${added.entry.id} をOCR結果としてCSV対象へ追加しました。`)
    }
    catch (error) {
      if (!isCurrent())
        return
      setMessage(pdfProcessingErrorMessage(
        error,
        '選択範囲をOCRできませんでした。',
      ))
    }
    finally {
      if (!disposed) {
        ocrRunning.value = false
        ocrStatus.value = ''
      }
    }
  }

  return {
    running: readonly(ocrRunning),
    progress: readonly(ocrProgress),
    status: readonly(ocrStatus),
    recognizeArea: addOcrArea,
  }
}
