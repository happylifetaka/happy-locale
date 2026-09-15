<script setup lang="ts">
export interface DiagnosticEntry {
  time: string
  message: string
  details?: string
  level: 'info' | 'error'
}

defineProps<{ entries: readonly DiagnosticEntry[] }>()
defineEmits<{ close: [], clear: [] }>()
</script>

<template>
  <div
    class="confirmation-backdrop"
    @click.self="$emit('close')"
  >
    <section
      class="diagnostics-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-title"
      @keydown.esc="$emit('close')"
    >
      <div class="diagnostics-dialog-title">
        <div>
          <h2 id="diagnostics-title">
            診断ログ（{{ entries.length }}件）
          </h2>
          <p>画像データやファイル内容は記録しません。</p>
        </div>
        <button type="button" autofocus @click="$emit('close')">
          閉じる
        </button>
      </div>
      <ol v-if="entries.length">
        <li
          v-for="(entry, index) in entries"
          :key="`${entry.time}-${index}`"
          :class="{ error: entry.level === 'error' }"
        >
          <time>{{ entry.time }}</time>
          <span>{{ entry.message }}</span>
          <code v-if="entry.details">{{ entry.details }}</code>
        </li>
      </ol>
      <p v-else class="muted">
        ログはまだありません。
      </p>
      <div class="diagnostics-dialog-actions">
        <button
          type="button"
          :disabled="entries.length === 0"
          @click="$emit('clear')"
        >
          ログを消去
        </button>
      </div>
    </section>
  </div>
</template>
