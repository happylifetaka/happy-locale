<script setup lang="ts">
defineProps<{
  originalText: string
  endpoint: string
}>()

defineEmits<{
  send: []
  cancel: []
}>()
</script>

<template>
  <div class="confirmation-backdrop" @click.self="$emit('cancel')">
    <section
      class="translation-request-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="translation-request-title"
      @keydown.esc="$emit('cancel')"
    >
      <h2 id="translation-request-title">
        原文を送信しますか？
      </h2>
      <p class="muted">
        画像やアセットは送信しません。次の原文と言語指定だけをTranslation Endpointへ送信します。
      </p>
      <dl>
        <dt>送信先</dt>
        <dd><code>{{ endpoint }}</code></dd>
        <dt>言語</dt>
        <dd>英語（EN）→ 日本語（JA）</dd>
      </dl>
      <label>
        送信する原文
        <textarea :value="originalText" rows="6" readonly />
      </label>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="$emit('cancel')">
          キャンセル
        </button>
        <button type="button" class="primary" @click="$emit('send')">
          この内容を送信
        </button>
      </div>
    </section>
  </div>
</template>
