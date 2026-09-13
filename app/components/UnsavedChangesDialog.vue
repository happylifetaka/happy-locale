<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ resolve: [leave: boolean] }>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)

// 親の表示要求に合わせてネイティブダイアログを開閉する。
watch(() => props.open, (open) => {
  if (open)
    dialog.value?.showModal()
  else
    dialog.value?.close()
}, { flush: 'post' })
</script>

<template>
  <dialog
    ref="dialog"
    class="confirmation-dialog unsaved-changes-dialog"
    aria-labelledby="unsaved-changes-title"
    aria-describedby="unsaved-changes-description"
    @cancel.prevent="emit('resolve', false)"
  >
    <h2 id="unsaved-changes-title">
      未保存の変更があります
    </h2>
    <p id="unsaved-changes-description">
      このまま離れると、未保存の変更は失われます。保存する場合は編集に戻ってください。
    </p>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('resolve', false)">
        編集に戻る
      </button>
      <button type="button" class="confirmation-danger" @click="emit('resolve', true)">
        保存せずに離れる
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.unsaved-changes-dialog {
  margin: auto;
  border: 0;
}
.unsaved-changes-dialog::backdrop {
  background: #0008;
}
</style>
