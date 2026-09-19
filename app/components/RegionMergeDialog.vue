<script setup lang="ts">
import type { ImageAsset, TextRegion } from '~/types/editor'
import type { MergeOptions } from '~/utils/merge-regions'
import { renderCard } from '~/utils/canvas/render'
import { mergeTextRegions, regionDistance } from '~/utils/merge-regions'

const props = defineProps<{
  regions: TextRegion[]
  baseId: string
  image: HTMLImageElement
  assets: readonly ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  fontFamilies: ReadonlyMap<string, string>
}>()
const emit = defineEmits<{ close: [], apply: [ids: string[], options: MergeOptions] }>()
const titleId = useId()
const dialog = ref<HTMLDialogElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const selected = ref([props.baseId])
const separator = ref('\n')
const previewMode = ref<'selection' | 'result'>('selection')
const edits = reactive(Object.fromEntries(props.regions.map(region => [region.id, { originalText: region.originalText, translatedText: region.translatedText }])))
const base = props.regions.find(region => region.id === props.baseId)!
const candidates = computed(() => [...props.regions].sort((a, b) => regionDistance(base, a) - regionDistance(base, b)))
const ordered = computed(() => selected.value.map(id => props.regions.find(region => region.id === id)!))
const options = computed<MergeOptions>(() => ({
  baseId: props.baseId,
  separator: separator.value,
  originalText: selected.value.map(id => edits[id]!.originalText).filter(Boolean).join(separator.value),
  translatedText: selected.value.map(id => edits[id]!.translatedText).filter(Boolean).join(separator.value),
}))
const merged = computed(() => selected.value.length > 1 ? mergeTextRegions(ordered.value, options.value) : null)
const renderError = ref('')
function toggle(id: string) {
  if (id === props.baseId)
    return
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter(value => value !== id)
  }
  else {
    selected.value = [...selected.value, id].sort((a, b) => {
      const first = props.regions.find(region => region.id === a)!
      const second = props.regions.find(region => region.id === b)!
      const sameLine = Math.abs(first.y - second.y) < Math.min(first.height, second.height) / 2
      return sameLine ? first.x - second.x : first.y - second.y
    })
  }
}
function move(index: number, delta: number) {
  const ids = [...selected.value]
  ;[ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]
  selected.value = ids
}
function draw() {
  const target = canvas.value
  if (!target || !merged.value)
    return
  target.width = props.image.naturalWidth
  target.height = props.image.naturalHeight
  try {
    const context = target.getContext('2d')!
    const regions = props.regions.flatMap(region => region.id === props.baseId ? [merged.value!] : selected.value.includes(region.id) ? [] : [region])
    renderCard(context, props.image, target.width, target.height, regions, props.assets, props.assetImages, props.fontFamilies)
    renderError.value = ''
  }
  catch {
    renderError.value = 'プレビューを描画できませんでした。閉じてもう一度お試しください。'
  }
}
watch([merged, canvas], draw, { flush: 'post' })
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="region-merge-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
    <h2 :id="titleId">
      領域を結合
    </h2>
    <p>画像上の枠、または一覧から結合相手を選んでください。基準：{{ base.displayName || base.regionId }}</p>
    <div class="merge-columns">
      <div class="merge-images">
        <div class="merge-view-switch" aria-label="プレビュー表示">
          <button type="button" :aria-pressed="previewMode === 'selection'" @click="previewMode = 'selection'">
            領域を選択
          </button>
          <button type="button" :aria-pressed="previewMode === 'result'" :disabled="!merged" @click="previewMode = 'result'">
            結合後を確認
          </button>
        </div>
        <svg v-show="previewMode === 'selection' || !merged" :viewBox="`0 0 ${image.naturalWidth} ${image.naturalHeight}`" aria-label="結合する領域の選択">
          <image :href="image.src" :width="image.naturalWidth" :height="image.naturalHeight" />
          <rect v-if="merged" :x="merged.x" :y="merged.y" :width="merged.width" :height="merged.height" fill="none" stroke="#f97316" stroke-dasharray="6 4" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none" />
          <rect v-for="region in regions" :key="region.id" :x="region.x" :y="region.y" :width="region.width" :height="region.height" :fill="selected.includes(region.id) ? '#2563eb44' : '#ffffff22'" :stroke="selected.includes(region.id) ? '#2563eb' : '#64748b'" stroke-width="2" vector-effect="non-scaling-stroke" role="button" tabindex="0" :aria-label="`${region.displayName || region.regionId}を選択`" :aria-pressed="selected.includes(region.id)" @click="toggle(region.id)" @keydown.enter.prevent="toggle(region.id)" @keydown.space.prevent="toggle(region.id)" />
        </svg>
        <template v-if="merged">
          <canvas v-show="previewMode === 'result'" ref="canvas" aria-label="結合後のカード" />
        </template>
      </div>
      <div class="merge-details">
        <fieldset>
          <legend>結合する領域（近い順）</legend>
          <label v-for="region in candidates" :key="region.id" class="merge-candidate">
            <input type="checkbox" :checked="selected.includes(region.id)" :disabled="region.id === baseId" @change="toggle(region.id)">
            <span>{{ region.displayName || region.regionId }}{{ region.id === baseId ? '（基準）' : '' }}<small>{{ region.originalText || '原文なし' }}</small></span>
          </label>
        </fieldset>
        <label class="merge-separator">文章の区切り<select v-model="separator"><option value="&#10;">改行</option><option value=" ">スペース</option><option value="">区切りなし</option></select></label>
        <fieldset v-for="(region, index) in ordered" :key="region.id">
          <legend>{{ index + 1 }}. {{ region.displayName || region.regionId }}</legend>
          <div class="merge-order">
            <button type="button" :disabled="index === 0" :aria-label="`${region.displayName || region.regionId}を前へ`" @click="move(index, -1)">
              ↑ 前へ
            </button>
            <button type="button" :disabled="index === ordered.length - 1" :aria-label="`${region.displayName || region.regionId}を後へ`" @click="move(index, 1)">
              ↓ 後へ
            </button>
          </div>
          <label>原文<textarea v-model="edits[region.id]!.originalText" rows="2" /></label>
          <label>訳文<textarea v-model="edits[region.id]!.translatedText" rows="2" /></label>
        </fieldset>
      </div>
    </div>
    <p class="muted">
      文字・背景設定とCSV用IDは基準領域を引き継ぎます。訳文は下書きに戻ります。枠の間も背景処理の対象になるため、プレビューで図柄や保護領域を確認してください。
    </p>
    <p v-if="renderError" role="alert">
      {{ renderError }}
    </p>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!merged || !!renderError" @click="emit('apply', selected, options)">
        {{ selected.length }}つの領域を結合
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.region-merge-dialog { width: min(960px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 1rem; color: #1e293b; font: 0.9rem/1.5 system-ui, sans-serif; }
.region-merge-dialog::backdrop { background: #0f172a80; }
h2 { margin: 0; font-size: 1.2rem; }
.merge-view-switch { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
.merge-view-switch button[aria-pressed="true"] { border-color: #2563eb; background: #eff6ff; color: #174ea6; }
.merge-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
.merge-images svg, .merge-images canvas { width: 100%; max-height: 48vh; object-fit: contain; display: block; }
.merge-images svg rect[role="button"] { cursor: pointer; }
.merge-details { max-height: 48vh; overflow: auto; padding: 0.2rem; }
fieldset { border: 1px solid #cbd5e1; border-radius: 0.4rem; margin: 0 0 0.75rem; min-width: 0; }
label { display: grid; gap: 0.25rem; }
.merge-candidate { display: flex; align-items: start; gap: 0.5rem; margin: 0.4rem 0; }
small { display: block; color: #64748b; max-height: 3em; overflow: hidden; overflow-wrap: anywhere; }
textarea, select { width: 100%; font: inherit; border: 1px solid #cbd5e1; border-radius: 0.3rem; padding: 0.35rem; }
textarea { resize: vertical; }
.merge-separator { margin-bottom: 0.75rem; }
.merge-order { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.confirmation-actions { position: sticky; bottom: -1rem; padding: 0.75rem 0; background: white; }
@media (max-width: 600px) { .merge-columns { grid-template-columns: 1fr; } .merge-details { max-height: none; } }
</style>
