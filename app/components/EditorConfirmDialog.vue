<script setup lang="ts">
defineProps<{ id: string, title: string }>()
defineEmits<{ cancel: [], confirm: [] }>()
</script>

<template>
  <div class="confirmation-backdrop" @click.self="$emit('cancel')">
    <section
      class="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="`${id}-description`"
      @keydown.esc="$emit('cancel')"
    >
      <h2 :id="`${id}-title`">
        {{ title }}
      </h2>
      <p :id="`${id}-description`">
        <slot />
      </p>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="$emit('cancel')">
          キャンセル
        </button>
        <button type="button" class="confirmation-danger" @click="$emit('confirm')">
          削除
        </button>
      </div>
    </section>
  </div>
</template>
