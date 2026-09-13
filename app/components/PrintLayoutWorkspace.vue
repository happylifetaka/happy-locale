<script setup lang="ts">
import type {
  FolderProjectCard,
  ImageAsset,
  ImageDpi,
  PrintLayoutSettings,
} from '~/types/editor'
import { PDFDocument, rgb } from 'pdf-lib'
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  layoutPrintAreas,
} from '~/services/print-layout'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { renderCard } from '~/utils/canvas/render'
import { downloadBlob } from '~/utils/download'
import { readImageDpi } from '~/utils/image-dpi'

const props = defineProps<{
  projectName: string
  cards: FolderProjectCard[]
  directory: FileSystemDirectoryHandle
  settings: PrintLayoutSettings
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  fontFamilies: ReadonlyMap<string, string>
}>()

const emit = defineEmits<{
  close: []
  updateSettings: [settings: PrintLayoutSettings]
  updateDpi: [cardId: string, dpi: ImageDpi]
}>()

/** 印刷用PDFを書き出しているか。 */
const exporting = ref(false)
/** 印刷用画像の生成状態と開始処理。画面終了時の解放はcomposableが担う。 */
const { previews, loading, errorMessage, preparePreviews } = usePrintPreviews(
  () => props.cards,
  renderCardPrintArea,
)
/** カードの実寸と用紙設定から求めたページ配置。 */
const layout = computed(() => layoutPrintAreas(props.cards, props.settings))
/** 横幅超過が最も大きく、余白調整の基準となる行。 */
const mostConstrainedRow = computed(() => layout.value.overflowingRows.reduce(
  (current, row) => !current || row.overflowMm > current.overflowMm
    ? row
    : current,
  null as (typeof layout.value.overflowingRows)[number] | null,
))
/** プレビュー準備とレイアウトの検証を終え、書き出せる状態か。 */
const canExport = computed(() =>
  !loading.value
  && !exporting.value
  && layout.value.pages.length > 0
  && layout.value.missingAreaCardIds.length === 0
  && layout.value.missingDpiCardIds.length === 0
  && layout.value.overflowingCardIds.length === 0
  && layout.value.pages.every(page => page.items.every(item =>
    previews.value.has(item.cardId))),
)

/** 変更した設定を現在値へ重ねて反映する。 */
function updateSettings(patch: Partial<PrintLayoutSettings>) {
  const next = { ...props.settings, ...patch }
  emit('updateSettings', {
    columns: next.columns === 1 || next.columns === 2 ? next.columns : 3,
    marginMm: Number.isFinite(next.marginMm)
      ? Math.min(30, Math.max(0, next.marginMm))
      : props.settings.marginMm,
    gapMm: Number.isFinite(next.gapMm)
      ? Math.min(20, Math.max(0, next.gapMm))
      : props.settings.gapMm,
    cutMarks: next.cutMarks,
  })
}

/** 画像ファイルを表示用の要素へ読み込む。 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name}を画像として読み込めませんでした。`))
    }
    image.src = url
  })
}

/** Canvasの描画内容をPNGのBlobへ変換する。 */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('印刷画像を作成できませんでした。')),
    'image/png',
  ))
}

/** 通常のカード描画を行ってから印刷範囲を切り出し、プレビューとPDFで同じ画像を使用する。 */
async function renderCardPrintArea(card: FolderProjectCard, signal: AbortSignal) {
  if (!card.printArea)
    return null
  const file = await loadFolderProjectCardImage(props.directory, card)
  if (signal.aborted)
    return null
  if (!card.sourceDpi) {
    const dpi = await readImageDpi(file)
    if (signal.aborted)
      return null
    if (dpi)
      emit('updateDpi', card.id, dpi)
  }
  const image = await loadImage(file)
  if (signal.aborted)
    return null
  const full = document.createElement('canvas')
  full.width = card.imageWidth
  full.height = card.imageHeight
  const fullContext = full.getContext('2d')
  if (!fullContext)
    throw new Error('カード画像を描画できませんでした。')
  renderCard(
    fullContext,
    image,
    card.imageWidth,
    card.imageHeight,
    card.regions,
    props.assets.filter(asset => props.assetImages.has(asset.id)),
    props.assetImages,
    props.fontFamilies,
  )
  const area = card.printArea
  const crop = document.createElement('canvas')
  crop.width = Math.max(1, Math.round(area.width))
  crop.height = Math.max(1, Math.round(area.height))
  crop.getContext('2d')?.drawImage(
    full,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  return canvasBlob(crop)
}

/** mmをPDFのpoint単位へ換算する。 */
function mmToPoints(value: number) {
  return value * 72 / 25.4
}

/** カードの印刷位置に合わせて裁断ガイドを描く。 */
function drawCutMarks(
  page: ReturnType<PDFDocument['addPage']>,
  item: ReturnType<typeof layoutPrintAreas>['pages'][number]['items'][number],
) {
  const length = mmToPoints(2)
  const offset = mmToPoints(0.8)
  const left = mmToPoints(item.xMm)
  const right = mmToPoints(item.xMm + item.widthMm)
  const bottom = mmToPoints(A4_HEIGHT_MM - item.yMm - item.heightMm)
  const top = mmToPoints(A4_HEIGHT_MM - item.yMm)
  const segments = [
    [left - offset - length, top + offset, left - offset, top + offset],
    [left - offset, top + offset, left - offset, top + offset + length],
    [right + offset, top + offset, right + offset + length, top + offset],
    [right + offset, top + offset, right + offset, top + offset + length],
    [left - offset - length, bottom - offset, left - offset, bottom - offset],
    [left - offset, bottom - offset - length, left - offset, bottom - offset],
    [right + offset, bottom - offset, right + offset + length, bottom - offset],
    [right + offset, bottom - offset - length, right + offset, bottom - offset],
  ]
  segments.forEach(([startX, startY, endX, endY]) => page.drawLine({
    start: { x: startX!, y: startY! },
    end: { x: endX!, y: endY! },
    thickness: 0.35,
    color: rgb(0.35, 0.35, 0.35),
  }))
}

/** 実寸レイアウトのmmをPDFのpointへ変換し、カード画像と必要な裁断ガイドを配置する。 */
async function exportPdf() {
  if (!canExport.value)
    return
  exporting.value = true
  errorMessage.value = ''
  try {
    const pdf = await PDFDocument.create()
    for (const layoutPage of layout.value.pages) {
      const page = pdf.addPage([
        mmToPoints(A4_WIDTH_MM),
        mmToPoints(A4_HEIGHT_MM),
      ])
      for (const item of layoutPage.items) {
        const preview = previews.value.get(item.cardId)
        if (!preview)
          continue
        const image = await pdf.embedPng(await preview.blob.arrayBuffer())
        page.drawImage(image, {
          x: mmToPoints(item.xMm),
          y: mmToPoints(A4_HEIGHT_MM - item.yMm - item.heightMm),
          width: mmToPoints(item.widthMm),
          height: mmToPoints(item.heightMm),
        })
        if (props.settings.cutMarks)
          drawCutMarks(page, item)
      }
    }
    const bytes = await pdf.save()
    const name = props.projectName.trim() || 'happy-locale'
    downloadBlob(
      new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      `${name}-print.pdf`,
    )
  }
  catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : '印刷PDFを作成できませんでした。'
  }
  finally {
    exporting.value = false
  }
}

// 印刷画面を開いたらカードごとの切り出し画像を準備する。
onMounted(preparePreviews)
</script>

<template>
  <main class="print-layout-workspace">
    <header class="print-layout-header">
      <div>
        <h1>A4印刷レイアウト</h1>
        <p>和訳シールを実寸のまま、3列を基本に配置します。</p>
      </div>
      <div>
        <button type="button" @click="$emit('close')">
          カード編集へ戻る
        </button>
        <button type="button" class="primary" :disabled="!canExport" @click="exportPdf">
          {{ exporting ? 'PDF作成中…' : 'A4 PDFを保存' }}
        </button>
      </div>
    </header>
    <section class="print-layout-controls" aria-label="A4レイアウト設定">
      <label>
        列数
        <select
          :value="settings.columns"
          @change="updateSettings({ columns: Number(($event.target as HTMLSelectElement).value) as 1 | 2 | 3 })"
        >
          <option :value="1">1列</option>
          <option :value="2">2列</option>
          <option :value="3">3列</option>
        </select>
      </label>
      <label>
        用紙余白
        <input
          type="number"
          min="0"
          max="30"
          step="0.01"
          :value="settings.marginMm"
          @change="updateSettings({ marginMm: Number(($event.target as HTMLInputElement).value) })"
        > mm
      </label>
      <label>
        カード間隔
        <input
          type="number"
          min="0"
          max="20"
          step="0.1"
          :value="settings.gapMm"
          @change="updateSettings({ gapMm: Number(($event.target as HTMLInputElement).value) })"
        > mm
      </label>
      <label>
        <input
          type="checkbox"
          :checked="settings.cutMarks"
          @change="updateSettings({ cutMarks: ($event.target as HTMLInputElement).checked })"
        >
        裁断ガイドを付ける
      </label>
    </section>
    <aside v-if="layout.missingAreaCardIds.length" class="print-layout-warning">
      印刷範囲が未設定のカードが{{ layout.missingAreaCardIds.length }}枚あります。
    </aside>
    <aside v-if="layout.missingDpiCardIds.length" class="print-layout-warning">
      DPIを確認できないカードが{{ layout.missingDpiCardIds.length }}枚あります。カード編集の「印刷範囲」から入力してください。
    </aside>
    <aside v-if="mostConstrainedRow" class="print-layout-warning">
      <strong>横幅が{{ mostConstrainedRow.overflowMm.toFixed(3) }}mm超過しています。</strong>
      <span>
        シール幅合計{{ mostConstrainedRow.sealWidthMm.toFixed(3) }}mm
        ＋ 間隔合計{{ mostConstrainedRow.gapWidthMm.toFixed(3) }}mm
        ＝ 必要幅{{ mostConstrainedRow.requiredWidthMm.toFixed(3) }}mmです。
      </span>
      <span>
        シール以外に使える幅{{ mostConstrainedRow.availableNonSealWidthMm.toFixed(3) }}mmに対し、
        左右余白合計{{ (settings.marginMm * 2).toFixed(3) }}mm
        ＋ 間隔合計{{ mostConstrainedRow.gapWidthMm.toFixed(3) }}mm
        ＝ {{ mostConstrainedRow.configuredNonSealWidthMm.toFixed(3) }}mmを使用しています。
      </span>
      <span v-if="mostConstrainedRow.maximumMarginMm >= 0">
        現在の間隔では、片側余白を{{ Math.floor(mostConstrainedRow.maximumMarginMm * 100) / 100 }}mm以下にしてください。
      </span>
      <span v-else>
        シール幅と間隔の合計がA4幅を超えています。列数、印刷範囲、または間隔を調整してください。
      </span>
    </aside>
    <aside
      v-else-if="layout.overflowingCardIds.length"
      class="print-layout-warning"
    >
      縦方向に実寸のまま収まらない印刷範囲があります。用紙余白または印刷範囲を調整してください。
    </aside>
    <p v-if="errorMessage" class="print-layout-warning" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="loading" class="muted" role="status">
      印刷プレビューを作成しています…
    </p>
    <section v-if="layout.pages.length" class="print-layout-pages" aria-label="A4印刷プレビュー">
      <article v-for="(page, pageIndex) in layout.pages" :key="pageIndex" class="print-layout-page">
        <span class="print-layout-page-number">{{ pageIndex + 1 }}ページ</span>
        <div
          v-for="item in page.items"
          :key="item.cardId"
          class="print-layout-item"
          :class="{ overflow: item.overflow }"
          :style="{
            left: `${item.xMm / A4_WIDTH_MM * 100}%`,
            top: `${item.yMm / A4_HEIGHT_MM * 100}%`,
            width: `${item.widthMm / A4_WIDTH_MM * 100}%`,
            height: `${item.heightMm / A4_HEIGHT_MM * 100}%`,
          }"
          :title="`${item.cardName}：${item.widthMm.toFixed(1)} × ${item.heightMm.toFixed(1)} mm`"
        >
          <img v-if="previews.get(item.cardId)" :src="previews.get(item.cardId)?.url" alt="">
          <span v-else>{{ item.cardName }}</span>
        </div>
      </article>
    </section>
    <p class="muted print-layout-print-note">
      PDFは印刷時に「実際のサイズ」または「100%」を選び、「用紙に合わせる」を無効にしてください。
    </p>
  </main>
</template>
