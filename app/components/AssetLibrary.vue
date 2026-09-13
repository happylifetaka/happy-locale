<script setup lang="ts">
import type { ImageAsset, TextRegion } from '~/types/editor'
import { validateAssetName } from '~/utils/assets'

const props = defineProps<{
  assets: ImageAsset[]
  image: HTMLImageElement | null
  assetImages: ReadonlyMap<string, CanvasImageSource>
  assetEditing: boolean
  selectedRegion: TextRegion | null
  showCreate?: boolean
  showInsert?: boolean
  showAdjustments?: boolean
  showRecrop?: boolean
}>()

const emit = defineEmits<{
  toggleEditing: []
  rename: [id: string, name: string]
  remove: [id: string]
  insert: [asset: ImageAsset]
  update: [id: string, patch: Partial<ImageAsset>]
  recrop: [id: string]
}>()

/** アセットIDごとの見本画像のData URL。 */
const previews = ref(new Map<string, string>())
/** アセットIDごとの改名時の検証エラー。 */
const nameErrors = ref(new Map<string, string>())

/** アセット画像から一覧表示用のプレビューを作り直す。 */
function rebuildPreviews() {
  previews.value.forEach(url => URL.revokeObjectURL(url))
  const next = new Map<string, string>()
  for (const asset of props.assets) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(asset.sourceRect.width))
    canvas.height = Math.max(1, Math.round(asset.sourceRect.height))
    const assetImage = props.assetImages.get(asset.id)
    if (assetImage) {
      canvas
        .getContext('2d')
        ?.drawImage(assetImage, 0, 0, canvas.width, canvas.height)
      next.set(asset.id, canvas.toDataURL('image/png'))
    }
  }
  previews.value = next
}

// アセット定義や画像が変わったら一覧用プレビューを更新する。
watch(() => [props.assets, props.assetImages], rebuildPreviews, {
  deep: true,
  flush: 'post',
})
// 初回表示時にアセットの見本を作る。
onMounted(rebuildPreviews)
// 一覧終了時にURLの解除を試みる。現在の見本はData URLのため、revokeObjectURLの対象外。
onBeforeUnmount(() => previews.value.forEach(url => URL.revokeObjectURL(url)))

/** 入力された表示名の変更を親へ通知する。 */
function rename(asset: ImageAsset, event: Event) {
  const input = event.target as HTMLInputElement
  const name = input.value.trim()
  const error = validateAssetName(name, props.assets, asset.id)
  if (error) {
    nameErrors.value = new Map(nameErrors.value).set(asset.id, error)
    input.value = asset.name
    return
  }
  const nextErrors = new Map(nameErrors.value)
  nextErrors.delete(asset.id)
  nameErrors.value = nextErrors
  emit('rename', asset.id, name)
}

/** 数値入力を変換し、設定変更を親へ通知する。 */
function updateNumber(
  asset: ImageAsset,
  field: 'scale' | 'baselineOffset' | 'inlinePadding',
  event: Event,
) {
  emit('update', asset.id, {
    [field]: Number((event.target as HTMLInputElement).value),
  })
}
</script>

<template>
  <section class="asset-library">
    <h3>アセット</h3>
    <button
      v-if="showCreate !== false"
      type="button"
      :class="{ primary: assetEditing }"
      :disabled="!image"
      @click="$emit('toggleEditing')"
    >
      {{ assetEditing ? '画像上をドラッグ' : '画像からアセットを登録' }}
    </button>
    <p class="muted">
      アイコンを矩形で囲むとプロジェクト内で再利用できます。
    </p>
    <p v-if="assets.length === 0" class="muted">
      登録済みアセットはありません。
    </p>
    <div v-for="asset in assets" :key="asset.id" class="asset-item">
      <img
        v-if="previews.get(asset.id)"
        :src="previews.get(asset.id)"
        :alt="`${asset.name}のプレビュー`"
      >
      <div>
        <input
          :value="asset.name"
          :aria-invalid="nameErrors.has(asset.id)"
          @change="rename(asset, $event)"
        >
        <small v-if="nameErrors.get(asset.id)" class="field-error" role="alert">
          {{ nameErrors.get(asset.id) }}
        </small>
        <button
          v-if="showInsert !== false"
          type="button"
          :disabled="!selectedRegion"
          @click="$emit('insert', asset)"
        >
          訳文へ挿入
        </button>
        <button
          v-if="showRecrop"
          type="button"
          :disabled="!image"
          :title="image ? '元画像から切り出し直す' : '先にアセット元画像を開いてください'"
          @click="$emit('recrop', asset.id)"
        >
          切り出し直し
        </button>
        <button type="button" @click="$emit('remove', asset.id)">
          削除
        </button>
        <details v-if="showAdjustments" class="asset-adjustments">
          <summary>詳細設定</summary>
          <label>
            表示倍率（{{ Math.round(asset.scale * 100) }}%）
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              :value="asset.scale"
              @input="updateNumber(asset, 'scale', $event)"
            >
          </label>
          <label>
            上下位置（{{ asset.baselineOffset.toFixed(2) }}em）
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              :value="asset.baselineOffset"
              @input="updateNumber(asset, 'baselineOffset', $event)"
            >
          </label>
          <label>
            左右余白（{{ asset.inlinePadding.toFixed(2) }}em）
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="asset.inlinePadding"
              @input="updateNumber(asset, 'inlinePadding', $event)"
            >
          </label>
        </details>
      </div>
    </div>
  </section>
</template>
