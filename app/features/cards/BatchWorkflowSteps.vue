<script setup lang="ts">
defineProps<{ step: number, labels: [string, string, string] }>()
</script>

<template>
  <ol class="batch-workflow-steps" aria-label="作業の進み具合">
    <li v-for="(label, index) in labels" :key="index" :aria-current="step === index + 1 ? 'step' : undefined">
      <span>{{ index + 1 }}</span>{{ label }}
    </li>
  </ol>
</template>

<style scoped>
.batch-workflow-steps { display: flex; flex-wrap: wrap; gap: 8px 24px; list-style: none; padding: 0; margin: 24px 0 16px; font-size: 13px; color: #64748b; }
li { display: flex; align-items: center; gap: 8px; }
li > span { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #f1f5f9; }
li[aria-current] { color: #174ea6; font-weight: 600; }
li[aria-current] > span { background: #e8f0ff; }
</style>
