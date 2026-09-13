import type { Worker } from 'tesseract.js'
import type {
  OCROptions,
  OCRProvider,
  OCRResult,
  OCRTextBlock,
} from './types'

/** 改行形式・行内空白・空行をOCR原文用に整える。 */
export function normalizeOCRText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => line.trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .join('\n')
}

/** 二つの文字範囲が同じ行に属するか判断するため縦方向の重なりを求める。 */
function verticalOverlap(first: OCRTextBlock, second: OCRTextBlock): number {
  const overlap = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height)
    - Math.max(first.y, second.y),
  )
  return overlap / Math.max(1, Math.min(first.height, second.height))
}

/** 縦方向の重なりで同じ行をまとめ、行内は左から右へ並べて読み順を復元する。 */
export function textInReadingOrder(blocks: readonly OCRTextBlock[]): string {
  const normalized = blocks
    .map(block => ({ ...block, text: normalizeOCRText(block.text) }))
    .filter(block => block.text)
    .sort((first, second) => first.y - second.y || first.x - second.x)
  const rows: OCRTextBlock[][] = []
  for (const block of normalized) {
    const row = rows.findLast(items =>
      items.some(item => verticalOverlap(item, block) >= 0.5),
    )
    if (row)
      row.push(block)
    else
      rows.push([block])
  }
  return rows
    .flatMap(row => row.sort((first, second) => first.x - second.x))
    .map(block => block.text)
    .join('\n')
}

/** アプリの配信パスからOCRの静的資源の場所を組み立てる。 */
export function resolveOCRAssetBase(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/ocr`
}

export class TesseractOCRProvider implements OCRProvider {
  private workerPromise: Promise<Worker> | null = null
  private progressHandler: OCROptions['onProgress']
  private readonly assetBase: string

  constructor(baseURL = '/') {
    this.assetBase = resolveOCRAssetBase(baseURL)
  }

  /** 初期化Promiseを共有してWorkerを再利用する。初期化失敗時は破棄し、次回の再試行を許す。 */
  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = import('tesseract.js').then(
        async ({ createWorker, OEM }) =>
          createWorker('eng', OEM.LSTM_ONLY, {
            workerPath: `${this.assetBase}/worker/worker.min.js`,
            corePath: `${this.assetBase}/core`,
            langPath: `${this.assetBase}/lang`,
            logger: message =>
              this.progressHandler?.({
                status: message.status,
                progress: message.progress,
              }),
          }),
      )
    }
    try {
      return await this.workerPromise
    }
    catch (error) {
      this.workerPromise = null
      throw error
    }
  }

  /** 行・段落の指定をOCRへ渡し、本文に加えてアイコン挿入用の単語座標も返す。 */
  async recognize(image: Blob, options: OCROptions = {}): Promise<OCRResult> {
    this.progressHandler = options.onProgress
    try {
      const [{ PSM }, worker] = await Promise.all([
        import('tesseract.js'),
        this.getWorker(),
      ])
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode:
          options.layout === 'single-line'
            ? PSM.SINGLE_LINE
            : options.layout === 'sparse-text'
              ? PSM.SPARSE_TEXT
              : PSM.SINGLE_BLOCK,
      })
      const result = await worker.recognize(image, {}, { blocks: true })
      const blocks: OCRTextBlock[]
        = result.data.blocks?.flatMap(block =>
          block.paragraphs.flatMap(paragraph =>
            paragraph.lines.map(line => ({
              text: normalizeOCRText(line.text),
              x: line.bbox.x0,
              y: line.bbox.y0,
              width: line.bbox.x1 - line.bbox.x0,
              height: line.bbox.y1 - line.bbox.y0,
              confidence: Number.isFinite(line.confidence)
                ? line.confidence
                : null,
            })),
          ),
        ) ?? []
      return {
        text: options.layout === 'single-line' || blocks.length === 0
          ? normalizeOCRText(result.data.text)
          : textInReadingOrder(blocks),
        confidence: Number.isFinite(result.data.confidence)
          ? result.data.confidence
          : null,
        blocks,
        words: result.data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words.map(word => ({
          text: normalizeOCRText(word.text),
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
          confidence: Number.isFinite(word.confidence) ? word.confidence : null,
        }))))) ?? [],
      }
    }
    finally {
      this.progressHandler = undefined
    }
  }

  /** OCR Workerを終了し、初期化状態と進捗通知先を解除する。 */
  async dispose(): Promise<void> {
    const workerPromise = this.workerPromise
    this.workerPromise = null
    this.progressHandler = undefined
    if (workerPromise)
      await (await workerPromise).terminate()
  }
}
