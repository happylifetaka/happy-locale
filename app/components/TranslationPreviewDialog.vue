<script setup lang="ts">
import { translationNumberDifferences } from '~/utils/translation-number-differences'

const props = defineProps<{
  originalText: string
  currentTranslation: string
  proposedTranslation: string
}>()

defineEmits<{
  apply: []
  cancel: []
}>()

const numberWarnings = computed(() => translationNumberDifferences(props.originalText, props.proposedTranslation))
</script>

<template>
  <div class="confirmation-backdrop" @click.self="$emit('cancel')">
    <section
      class="translation-preview-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="translation-preview-title"
      @keydown.esc="$emit('cancel')"
    >
      <h2 id="translation-preview-title">
        翻訳結果を確認
      </h2>
      <p class="muted">
        提案訳はまだ領域へ反映されていません。現在の訳文との差を確認してください。
      </p>
      <label>
        翻訳元の原文
        <textarea :value="originalText" rows="3" readonly />
      </label>
      <div class="translation-preview-columns">
        <label>
          現在の訳文
          <textarea :value="currentTranslation" rows="6" readonly />
        </label>
        <label>
          提案訳
          <textarea :value="proposedTranslation" rows="6" readonly />
        </label>
      </div>
      <ul v-if="numberWarnings.length" role="status">
        <li v-for="warning in numberWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="$emit('cancel')">
          破棄
        </button>
        <button type="button" class="primary" @click="$emit('apply')">
          提案訳を反映
        </button>
      </div>
    </section>
  </div>
</template>
