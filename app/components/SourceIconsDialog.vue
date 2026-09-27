<script setup lang="ts">
import type { AssetCreationDraft, ImageAsset, SourceIcon, TextRegion } from '~/types/editor'
import { assetSimilarity, fingerprintImage } from '~/utils/asset-matching'
import { sourceIconProblems } from '~/utils/source-icons'
import AssetCreationPanel from './AssetCreationPanel.vue'
import AssetMatchPreview from './AssetMatchPreview.vue'

const props = defineProps<{ region: TextRegion, imageUrl: string, imageWidth: number, imageHeight: number, assets: ImageAsset[], image: HTMLImageElement, assetImages: ReadonlyMap<string, CanvasImageSource>, createAsset: (draft: AssetCreationDraft, isCurrent: () => boolean) => Promise<ImageAsset | null> }>()
const emit = defineEmits<{ close: [], apply: [icons: SourceIcon[]], recognize: [icons: SourceIcon[]] }>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)
/** アイコン範囲の描画と座標変換に使用するSVG要素。 */
const svg = ref<SVGSVGElement | null>(null)
const titleId = useId()
/** 確定前に元の領域を変更しないよう、アイコン範囲はダイアログ内で複製して編集する。 */
const icons = ref<SourceIcon[]>(JSON.parse(JSON.stringify(props.region.sourceIcons ?? [])))
/** 原文上の範囲に割り当てるアセットID。 */
const assetId = ref('')
/** 原文アイコンの範囲指定を開始した領域内の座標。 */
const start = ref<{ x: number, y: number } | null>(null)
/** ドラッグ中の原文アイコン範囲。領域内の相対座標。 */
const draft = ref<SourceIcon | null>(null)
/** アイコン参照と範囲の検証結果。 */
const problems = computed(() => sourceIconProblems({ ...props.region, sourceIcons: icons.value }, [...props.assets, { id: '' }]))
/** 候補の選択状態は保存せず、アセットを選んだ範囲だけ確定情報へ変換する。 */
const selectedId = ref<string | null>(null)
const selected = computed(() => icons.value.find(icon => icon.id === selectedId.value))
const creation = ref<AssetCreationDraft | null>(null)
const running = ref(false)
const error = ref('')
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
const confirmed = computed(() => icons.value.filter(icon => icon.assetId))
const matches = computed(() => {
  const icon = selected.value
  if (!icon)
    return []
  try {
    const target = fingerprintImage(props.image, { ...icon, x: props.region.x + icon.x, y: props.region.y + icon.y })
    if (!target)
      return []
    return props.assets.flatMap((asset) => {
      const image = props.assetImages.get(asset.id)
      const fingerprint = image && fingerprintImage(image)
      return fingerprint ? [{ asset, score: assetSimilarity(target, fingerprint) }] : []
    }).sort((a, b) => b.score - a.score).slice(0, 5)
  }
  catch {
    return []
  }
})

function selectIcon(id: string) {
  selectedId.value = id
  creation.value = null
  error.value = ''
}

function create() {
  const icon = selected.value
  if (!icon || problems.value.length)
    return
  creation.value = {
    editingAssetId: null,
    name: `asset_${props.assets.length + 1}`,
    sourceRect: { x: props.region.x + icon.x, y: props.region.y + icon.y, width: icon.width, height: icon.height },
    removeBackground: true,
    backgroundColor: null,
    backgroundThreshold: 48,
    edgeFeather: 12,
    manualMaskStrokes: [],
  }
}

async function register() {
  const draft = creation.value
  const icon = selected.value
  if (!draft || !icon || running.value)
    return
  running.value = true
  error.value = ''
  const isCurrent = () => !disposed && creation.value === draft && selected.value === icon
  try {
    const asset = await props.createAsset(draft, isCurrent)
    if (asset && isCurrent()) {
      icon.assetId = asset.id
      creation.value = null
    }
  }
  catch (cause) {
    if (isCurrent())
      error.value = cause instanceof Error ? cause.message : 'アイコンを登録できませんでした。'
  }
  finally { running.value = false }
}

function removeIcon(index: number) {
  icons.value.splice(index, 1)
  creation.value = null
}

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
  if (creation.value || event.button !== 0)
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
  if (draft.value && draft.value.width >= 3 && draft.value.height >= 3) {
    const icon = { ...draft.value, id: crypto.randomUUID() }
    icons.value.push(icon)
    selectIcon(icon.id)
  }
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
      元画像のアイコンを指定・登録
    </h2>
    <p>画像のアイコンだけをドラッグして囲み、候補を確認してください。文字や数字を囲まないようにします。</p>
    <p>指定部分をOCRから除き、単語の位置を使って原文候補へアイコン記法を差し込みます。背景補修から画像を守る「保護領域」とは別の設定です。</p>
    <p>自動補修・手動マスクでは、囲った範囲の元アイコンを消して背景を補修します。保護領域と重なる部分は残ります。</p>
    <p v-if="!assets.length">
      画像を囲むと、この画面で新しいアイコンを登録できます。
    </p>
    <label>
      割り当てる登録済みアイコン
      <select v-model="assetId" aria-label="割り当てる登録済みアイコン">
        <option value="">範囲指定後に選ぶ</option>
        <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
      </select>
    </label>
    <svg ref="svg" :viewBox="`${region.x} ${region.y} ${region.width} ${region.height}`" role="img" aria-label="元画像のアイコン指定範囲" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="cancel" @lostpointercapture="cancel">
      <image :href="imageUrl" :width="imageWidth" :height="imageHeight" />
      <rect v-for="icon in [...icons, ...(draft ? [draft] : [])]" :key="icon.id" :x="region.x + icon.x" :y="region.y + icon.y" :width="icon.width" :height="icon.height" fill="#f59e0b33" stroke="#d97706" stroke-width="2" vector-effect="non-scaling-stroke" @pointerdown.stop @pointerup.stop="selectIcon(icon.id)" />
    </svg>
    <ol>
      <li v-for="(icon, index) in icons" :key="icon.id">
        <button type="button" :aria-pressed="selectedId === icon.id" @click="selectIcon(icon.id)">
          候補{{ index + 1 }}を確認
        </button>
        <label>アイコン{{ index + 1 }}の登録先
          <select v-model="icon.assetId" :disabled="Boolean(creation)">
            <option value="">未選択（OCRから除外しない）</option>
            <option v-if="icon.assetId && !assets.some(asset => asset.id === icon.assetId)" :value="icon.assetId">未登録のアイコン</option>
            <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
          </select>
        </label>
        <button type="button" :aria-label="`アイコン${index + 1}の指定を削除`" @click="removeIcon(index)">
          文字として扱う・指定を削除
        </button>
      </li>
    </ol>
    <section v-if="selected" aria-label="選択したアイコン候補">
      <h3>切り抜きとアイコン候補</h3>
      <fieldset :disabled="Boolean(creation)">
        <legend>範囲の調整（領域内の座標）</legend>
        <label v-for="field in (['x', 'y', 'width', 'height'] as const)" :key="field">{{ { x: '左位置', y: '上位置', width: '幅', height: '高さ' }[field] }}
          <input v-model.number="selected[field]" type="number" :min="field === 'x' || field === 'y' ? 0 : 1" step="1">
        </label>
      </fieldset>
      <svg :viewBox="`${region.x + selected.x} ${region.y + selected.y} ${selected.width} ${selected.height}`" class="crop-preview" role="img" aria-label="選択範囲の切り抜き">
        <image :href="imageUrl" :width="imageWidth" :height="imageHeight" />
      </svg>
      <p>類似度は比較用の値です。正解の確率ではありません。候補が一つでも選択して確認してください。</p>
      <p v-if="matches.length > 1">
        先頭と次点の差: {{ ((matches[0]!.score - matches[1]!.score) * 100).toFixed(1) }}
      </p>
      <ul>
        <li v-for="match in matches" :key="match.asset.id">
          <button type="button" :disabled="Boolean(creation)" @click="selected.assetId = match.asset.id">
            <AssetMatchPreview :image="assetImages.get(match.asset.id)" />
            {{ match.asset.name }}を使う（類似度 {{ (match.score * 100).toFixed(1) }}）
          </button>
        </li>
      </ul>
      <button type="button" :disabled="problems.length > 0" @click="create">
        この範囲から新規登録
      </button>
      <AssetCreationPanel v-if="creation" :image="image" :draft="creation" :existing-assets="assets" :running="running" @update="creation = { ...creation!, ...$event }" @confirm="register" @cancel="creation = null" />
      <p v-if="error" role="alert">
        {{ error }}
      </p>
    </section>
    <p v-for="problem in problems" :key="problem" role="alert">
      {{ problem }}
    </p>
    <p>範囲は数値で調整するか、指定を削除して囲み直せます。未選択の範囲はOCRから除外しません。登録済みアイコンはキャンセルや原文のUndoでも残ります。</p>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="problems.length > 0 || Boolean(creation)" @click="emit('apply', confirmed)">
        アイコン指定を反映
      </button>
      <button type="button" class="primary" :disabled="problems.length > 0 || Boolean(creation)" @click="emit('recognize', confirmed)">
        指定を反映して再OCR
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.source-icons-dialog { width: min(900px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 1rem; color: #1e293b; font: 0.9rem/1.5 system-ui, sans-serif; }
.source-icons-dialog::backdrop { background: #0f172a80; }
.source-icons-dialog h2 { font-size: 1.2rem; margin: 0 0 0.75rem; }
.source-icons-dialog svg { width: 100%; max-height: 50vh; margin-top: 1rem; touch-action: none; cursor: crosshair; }
.source-icons-dialog .crop-preview { width: 120px; height: 100px; }
.source-icons-dialog fieldset { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.source-icons-dialog input[type="number"] { width: 5rem; margin-left: 0.3rem; font: inherit; }
.source-icons-dialog li { margin-bottom: 0.5rem; }
.source-icons-dialog select { font: inherit; padding: 0.35rem; border: 1px solid #cbd5e1; border-radius: 0.35rem; }
</style>
