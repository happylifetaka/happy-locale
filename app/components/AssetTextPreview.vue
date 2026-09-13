<script setup lang="ts">
import type { ImageAsset } from '~/types/editor'

const props = defineProps<{
  text: string
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
}>()
/** 原文・訳文のトークンを確認用チップに分ける。カード上の実際の組版はCanvas側が担う。 */
const parts = computed(() => props.text.split(/(\[icon:[^[\]\r\n]+\])/gu).filter(Boolean).map((text) => {
  const name = /^\[icon:([^[\]\r\n]+)\]$/u.exec(text)?.[1]
  return { text, name, asset: props.assets.find(asset => asset.name === name) }
}))
/** アセットの縦横比を保ち、確認用Canvasの中央へ描く。 */
function draw(element: unknown, asset?: ImageAsset) {
  if (!(element instanceof HTMLCanvasElement) || !asset)
    return
  const source = props.assetImages.get(asset.id)
  const context = element.getContext('2d')
  context?.clearRect(0, 0, 32, 32)
  if (!source)
    return
  const scale = 28 / Math.max(1, asset.sourceRect.width, asset.sourceRect.height)
  const width = asset.sourceRect.width * scale
  const height = asset.sourceRect.height * scale
  context?.drawImage(source, (32 - width) / 2, (32 - height) / 2, width, height)
}
</script>

<template>
  <span class="asset-text-preview">
    <template v-for="(part, index) in parts" :key="index">
      <span v-if="part.name" class="asset-chip" :class="{ unknown: !part.asset }" :title="part.text">
        <canvas v-if="part.asset" :ref="el => draw(el, part.asset)" width="32" height="32" aria-hidden="true" />
        {{ part.name }}
      </span>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>

<style scoped>
.asset-text-preview { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
.asset-chip { display: inline-flex; align-items: center; vertical-align: middle; gap: 0.15rem; padding: 0 0.3rem; border: 1px solid #c2d5e8; border-radius: 0.3rem; background: #edf5fc; font-size: 0.75rem; white-space: nowrap; }
.asset-chip canvas { width: 1.25rem; height: 1.25rem; }
.asset-chip.unknown { border-color: #dc9696; color: #982f2f; background: #fff1f1; }
</style>
