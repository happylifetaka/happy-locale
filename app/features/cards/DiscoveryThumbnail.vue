<script setup lang="ts">
import type { DiscoveryThumbnails, DiscoveryThumbnailState } from './useDiscoveryThumbnails'
import type { IconOccurrence } from '~/types/asset-discovery'
import { onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'

const props = defineProps<{ item: IconOccurrence, thumbnails: DiscoveryThumbnails, active: boolean }>()
const element = ref<HTMLElement | null>(null)
const visible = ref(false)
const state = shallowRef<DiscoveryThumbnailState>({})
let observer: IntersectionObserver | undefined
watch(() => [props.active, visible.value, props.thumbnails.key(props.item)], (_, __, onCleanup) => {
  state.value = {}
  if (props.active && visible.value)
    onCleanup(props.thumbnails.subscribe(props.item, next => state.value = next))
}, { immediate: true })
onMounted(() => {
  if (typeof IntersectionObserver !== 'function') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(entries => visible.value = entries.some(entry => entry.isIntersecting), { rootMargin: '100px' })
  if (element.value)
    observer.observe(element.value)
})
onScopeDispose(() => observer?.disconnect())
</script>

<template>
  <span ref="element" class="discovery-thumbnail" :title="state.error || '元画像から切り出した候補'" aria-hidden="true">
    <img v-if="state.url" :src="state.url" alt="" width="64" height="64">
    <span v-else>{{ state.error ? '!' : '…' }}</span>
  </span>
</template>

<style scoped>
.discovery-thumbnail { display: inline-flex; width: 64px; height: 64px; flex: 0 0 64px; align-items: center; justify-content: center; vertical-align: middle; background: #e2e8f0; margin-right: 6px; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
