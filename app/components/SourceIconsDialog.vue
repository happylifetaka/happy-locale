<script setup lang="ts">
import type { ImageAsset, SourceIcon, TextRegion } from '~/types/editor'
import { sourceIconProblems } from '~/utils/source-icons'

const props = defineProps<{ region: TextRegion, imageUrl: string, imageWidth: number, imageHeight: number, assets: ImageAsset[] }>()
const emit = defineEmits<{ close: [], apply: [icons: SourceIcon[]] }>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)
/** アイコン範囲の描画と座標変換に使用するSVG要素。 */
const svg = ref<SVGSVGElement | null>(null)
const titleId = useId()
/** 確定前に元の領域を変更しないよう、アイコン範囲はダイアログ内で複製して編集する。 */
const icons = ref<SourceIcon[]>(JSON.parse(JSON.stringify(props.region.sourceIcons ?? [])))
/** 原文上の範囲に割り当てるアセットID。 */
const assetId = ref(props.assets[0]?.id ?? '')
/** 原文アイコンの範囲指定を開始した領域内の座標。 */
const start = ref<{ x: number, y: number } | null>(null)
/** ドラッグ中の原文アイコン範囲。領域内の相対座標。 */
const draft = ref<SourceIcon | null>(null)
/** アイコン参照と範囲の検証結果。 */
const problems = computed(() => sourceIconProblems({ ...props.region, sourceIcons: icons.value }, props.assets))
// マウント後に原文アイコン指定のモーダルを開く。
onMounted(() => dialog.value?.showModal())

/** SVGの画面変換を逆にたどり、領域左上を原点とするアイコンの相対座標へ変換する。 */
function point(event: PointerEvent) {
  const matrix = svg.value?.getScreenCTM()
  if (!matrix)
    return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return {
    x: Math.max(0, Math.min(props.region.width, point.x - props.region.x)),
    y: Math.max(0, Math.min(props.region.height, point.y - props.region.y)),
  }
}
/** 原文アイコンの範囲指定を開始する。 */
function begin(event: PointerEvent) {
  if (!assetId.value || event.button !== 0)
    return
  start.value = point(event)
  svg.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}
/** 原文アイコンのドラッグ範囲を更新する。 */
function move(event: PointerEvent) {
  const current = point(event)
  if (!start.value || !current)
    return
  draft.value = {
    id: 'draft',
    assetId: assetId.value,
    x: Math.round(Math.min(current.x, start.value.x)),
    y: Math.round(Math.min(current.y, start.value.y)),
    width: Math.round(Math.abs(current.x - start.value.x)),
    height: Math.round(Math.abs(current.y - start.value.y)),
  }
}
/** 有効なアイコン範囲を下書き一覧へ確定する。 */
function end(event: PointerEvent) {
  move(event)
  if (draft.value && draft.value.width >= 3 && draft.value.height >= 3)
    icons.value.push({ ...draft.value, id: crypto.randomUUID() })
  cancel()
}
/** 操作中の仮状態を破棄して範囲指定を終了する。 */
function cancel() {
  start.value = null
  draft.value = null
}
</script>

<template>
  <dialog ref="dialog" class="source-icons-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
    <h2 :id="titleId">
      元画像のアイコンを指定
    </h2>
    <p>割り当てるアセットを選び、画像のアイコンだけをドラッグして囲んでください。文字や数字を囲まないようにします。</p>
    <p>指定部分をOCRから除き、単語の位置を使って原文候補へアイコン記法を差し込みます。背景補修から画像を守る「保護領域」とは別の設定です。</p>
    <p>自動補修・手動マスクでは、囲った範囲の元アイコンを消して背景を補修します。保護領域と重なる部分は残ります。</p>
    <p v-if="!assets.length">
      先に「アセット編集」でアイコンを切り出して登録してください。
    </p>
    <label>
      囲むアイコンに割り当てるアセット
      <select v-model="assetId" aria-label="囲むアイコンに割り当てるアセット">
        <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
      </select>
    </label>
    <svg ref="svg" :viewBox="`${region.x} ${region.y} ${region.width} ${region.height}`" role="img" aria-label="元画像のアイコン指定範囲" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="cancel" @lostpointercapture="cancel">
      <image :href="imageUrl" :width="imageWidth" :height="imageHeight" />
      <rect v-for="icon in [...icons, ...(draft ? [draft] : [])]" :key="icon.id" :x="region.x + icon.x" :y="region.y + icon.y" :width="icon.width" :height="icon.height" fill="#f59e0b33" stroke="#d97706" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
    <ol>
      <li v-for="(icon, index) in icons" :key="icon.id">
        <label>アイコン{{ index + 1 }}のアセット
          <select v-model="icon.assetId">
            <option v-if="!assets.some(asset => asset.id === icon.assetId)" :value="icon.assetId">未登録のアセット</option>
            <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
          </select>
        </label>
        <button type="button" :aria-label="`アイコン${index + 1}の指定を削除`" @click="icons.splice(index, 1)">
          指定を削除
        </button>
      </li>
    </ol>
    <p v-for="problem in problems" :key="problem" role="alert">
      {{ problem }}
    </p>
    <p>位置を変えるときは指定を削除し、囲み直してください。適用後にOCRを実行して読み順を確認します。</p>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="problems.length > 0" @click="emit('apply', icons)">
        アイコン指定を反映
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.source-icons-dialog { width: min(900px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 1rem; color: #1e293b; font: 0.9rem/1.5 system-ui, sans-serif; }
.source-icons-dialog::backdrop { background: #0f172a80; }
.source-icons-dialog h2 { font-size: 1.2rem; margin: 0 0 0.75rem; }
.source-icons-dialog svg { width: 100%; max-height: 50vh; margin-top: 1rem; touch-action: none; cursor: crosshair; }
.source-icons-dialog li { margin-bottom: 0.5rem; }
.source-icons-dialog select { font: inherit; padding: 0.35rem; border: 1px solid #cbd5e1; border-radius: 0.35rem; }
</style>
