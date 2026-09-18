<script setup lang="ts">
const props = defineProps<{ image: CanvasImageSource | undefined }>()
const canvas = ref<HTMLCanvasElement | null>(null)
function draw() {
  const context = canvas.value?.getContext('2d')
  if (!context)
    return
  context.clearRect(0, 0, 48, 48)
  if (props.image)
    context.drawImage(props.image, 0, 0, 48, 48)
}
onMounted(draw)
watch(() => props.image, draw, { flush: 'post' })
</script>

<template>
  <canvas ref="canvas" width="48" height="48" aria-hidden="true" />
</template>

<style scoped>
canvas { width: 48px; height: 48px; vertical-align: middle; background: #e2e8f0; }
</style>
