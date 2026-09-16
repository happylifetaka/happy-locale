<script setup lang="ts">
import type { TextRegion } from '~/types/editor'

defineProps<{
  src: string
  region: TextRegion
  imageWidth: number
  imageHeight: number
  previewHeight?: number
}>()
const clipId = useId()
</script>

<template>
  <!-- Source coordinates stay unchanged for ruby; its translated text is rendered elsewhere. -->
  <svg
    class="region-source-preview"
    :viewBox="`${region.x} ${region.y} ${region.width} ${region.height}`"
    :style="{ height: `${previewHeight ?? Math.max(48, Math.min(140, region.height / Math.max(1, region.width) * 300))}px` }"
    role="img"
    :aria-label="`${region.displayName || region.regionId}の原画像`"
  >
    <defs>
      <clipPath :id="clipId" clipPathUnits="userSpaceOnUse">
        <rect :x="region.x" :y="region.y" :width="region.width" :height="region.height" />
      </clipPath>
    </defs>
    <image :href="src" :width="imageWidth" :height="imageHeight" :clip-path="`url(#${clipId})`" />
  </svg>
</template>

<style scoped>
.region-source-preview {
  display: block;
  width: 100%;
  margin: 0.5rem 0;
  background: #eef1f5;
}
</style>
