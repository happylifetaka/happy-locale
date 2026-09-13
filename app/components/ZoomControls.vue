<script setup lang="ts">
const props = defineProps<{
  zoom: number
}>()

const emit = defineEmits<{
  updateZoom: [value: number]
}>()

/** 倍率変更ボタンと選択欄で共通に使用する表示倍率の候補。 */
const zoomLevels = [25, 50, 75, 100, 150, 200]

/** 用意した倍率候補の一つ前または後へ移す。 */
function changeZoom(direction: -1 | 1) {
  const currentIndex = zoomLevels.indexOf(props.zoom)
  const fallbackIndex = zoomLevels.findIndex(level => level >= props.zoom)
  const index = currentIndex >= 0 ? currentIndex : Math.max(0, fallbackIndex)
  const nextIndex = Math.max(
    0,
    Math.min(zoomLevels.length - 1, index + direction),
  )
  emit('updateZoom', zoomLevels[nextIndex]!)
}

/** 選択した表示倍率を親へ通知する。 */
function selectZoom(event: Event) {
  emit('updateZoom', Number((event.target as HTMLSelectElement).value))
}
</script>

<template>
  <div class="zoom-controls" role="group" aria-label="画像の表示倍率">
    <button
      type="button"
      class="icon-button"
      aria-label="縮小"
      title="縮小"
      :disabled="zoom <= zoomLevels[0]!"
      @click="changeZoom(-1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.2 15.2 5 5M7.5 10.5h6" />
      </svg>
    </button>
    <select :value="zoom" aria-label="表示倍率" @change="selectZoom">
      <option v-for="level in zoomLevels" :key="level" :value="level">
        {{ level }}%
      </option>
    </select>
    <button
      type="button"
      class="icon-button"
      aria-label="拡大"
      title="拡大"
      :disabled="zoom >= zoomLevels.at(-1)!"
      @click="changeZoom(1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.2 15.2 5 5M7.5 10.5h6M10.5 7.5v6" />
      </svg>
    </button>
  </div>
</template>
