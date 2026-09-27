<script setup lang="ts">
import { computed } from 'vue'
import { textDiff, visibleWhitespace } from '~/utils/text-diff'

const props = defineProps<{ original: string, corrected: string }>()
const parts = computed(() => textDiff(props.original, props.corrected))
</script>

<template>
  <span class="ocr-correction-diff">
    <template v-for="(part, index) in parts" :key="index">
      <span v-if="part.kind === 'equal'">{{ part.text }}</span>
      <del v-else-if="part.kind === 'delete'" :aria-label="`削除: ${visibleWhitespace(part.text)}`" :title="`削除: ${visibleWhitespace(part.text)}`">{{ visibleWhitespace(part.text) }}</del>
      <ins v-else :aria-label="`追加: ${visibleWhitespace(part.text)}`" :title="`追加: ${visibleWhitespace(part.text)}`">{{ visibleWhitespace(part.text) }}</ins>
    </template>
  </span>
</template>

<style scoped>
.ocr-correction-diff { white-space: pre-wrap; }
del, ins { padding: 0 0.1em; border-radius: 0.15em; font-weight: 700; }
</style>
