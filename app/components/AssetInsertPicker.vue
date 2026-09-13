<script setup lang="ts">
import type { ImageAsset } from '~/types/editor'

const props = defineProps<{
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  targetLabel: string
}>()
const emit = defineEmits<{ insert: [asset: ImageAsset] }>()
/** 挿入メニューの開閉と範囲判定に使用するdetails要素。 */
const root = ref<HTMLDetailsElement | null>(null)
/** 挿入メニューを閉じた後にフォーカスを戻すボタン。 */
const trigger = ref<HTMLElement | null>(null)
/** 識別子ごとに保持するプレビュー画像。 */
const previews = ref(new Map<string, string>())

/** アセット画像から一覧表示用のプレビューを作り直す。 */
function rebuildPreviews() {
  const next = new Map<string, string>()
  for (const asset of props.assets) {
    const source = props.assetImages.get(asset.id)
    if (!source)
      continue
    const canvas = document.createElement('canvas')
    const ratio = Math.min(64 / Math.max(1, asset.sourceRect.width), 64 / Math.max(1, asset.sourceRect.height))
    canvas.width = Math.max(1, Math.round(asset.sourceRect.width * ratio))
    canvas.height = Math.max(1, Math.round(asset.sourceRect.height * ratio))
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
    next.set(asset.id, canvas.toDataURL())
  }
  previews.value = next
}

/** Escapeなどで閉じた場合は挿入ボタンへフォーカスを戻し、キーボード操作を継続できるようにする。 */
function close(restoreFocus = false) {
  if (!root.value?.open)
    return
  root.value.open = false
  if (restoreFocus)
    trigger.value?.focus()
}

/** メニュー外のクリックを検出してメニューを閉じる。 */
function handlePointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target))
    close()
}

/** メニュー外へフォーカスが移った場合にメニューを閉じる。 */
function handleFocusOut(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget))
    close()
}

/** 選んだアセットを親へ通知し、挿入メニューを閉じる。 */
function insert(asset: ImageAsset) {
  close()
  emit('insert', asset)
}

// 共有アセットの変更後に挿入用の見本を更新する。
watch(() => [props.assets, props.assetImages], rebuildPreviews, { deep: true, flush: 'post' })
// 表示用見本とメニュー外クリックの監視を初期化する。
onMounted(() => {
  rebuildPreviews()
  document.addEventListener('pointerdown', handlePointerDown)
})
// 部品を閉じる際にメニュー外クリックの監視を解除する。
onBeforeUnmount(() => document.removeEventListener('pointerdown', handlePointerDown))
</script>

<template>
  <details ref="root" class="asset-insert-picker" @keydown.esc.stop.prevent="close(true)" @focusout="handleFocusOut">
    <summary ref="trigger" :aria-label="`${targetLabel}にアセットを挿入`">
      ＋ アセット
    </summary>
    <div class="asset-insert-panel">
      <p class="asset-insert-caption">
        {{ targetLabel }}に挿入
      </p>
      <div v-if="assets.length" class="asset-insert-options">
        <button v-for="asset in assets" :key="asset.id" type="button" @mousedown.prevent @click="insert(asset)">
          <span class="asset-insert-thumbnail">
            <img v-if="previews.get(asset.id)" :src="previews.get(asset.id)" alt="">
            <span v-else aria-hidden="true">◇</span>
          </span>
          <span>{{ asset.name }}</span>
        </button>
      </div>
      <p v-else class="asset-insert-empty">
        登録済みアセットはありません。上部の「アセット編集」から登録できます。
      </p>
    </div>
  </details>
</template>

<style scoped>
.asset-insert-picker {
  position: relative;
  flex-shrink: 0;
  font-size: 0.75rem;
}

summary {
  display: block;
  padding: 0.4rem 0.5rem;
  border-radius: 0.35rem;
  color: #245cc7;
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

summary:hover,
details[open] > summary {
  background: #edf3ff;
}

.asset-insert-panel {
  position: absolute;
  z-index: 10;
  top: calc(100% + 0.25rem);
  right: 0;
  width: min(16rem, 70vw);
  padding: 0.5rem;
  border: 1px solid #cbd2dc;
  border-radius: 0.5rem;
  background: white;
  box-shadow: 0 4px 16px #18223726;
}

.asset-insert-caption,
.asset-insert-empty {
  margin: 0;
  padding: 0.35rem;
  color: #49566a;
}

.asset-insert-options {
  display: grid;
  max-height: 15rem;
  overflow-y: auto;
  gap: 0.25rem;
}

.asset-insert-options button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem;
  text-align: left;
  overflow-wrap: anywhere;
}

.asset-insert-thumbnail {
  display: grid;
  place-items: center;
  flex: 0 0 2rem;
  height: 2rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.25rem;
  background: #f1f5f9;
}

.asset-insert-thumbnail img {
  max-width: 100%;
  max-height: 2rem;
  object-fit: contain;
}
</style>
