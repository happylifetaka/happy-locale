<script setup lang="ts">
import type { GlossaryEntry } from '~/types/editor'

const props = defineProps<{
  open: boolean
  entries: GlossaryEntry[]
}>()

const emit = defineEmits<{
  close: []
  add: [source: string, translation: string, note: string]
  update: [id: string, patch: Pick<GlossaryEntry, 'source' | 'translation' | 'note'>]
  remove: [id: string]
}>()

/** 一覧を絞り込む検索文字列。 */
const query = ref('')
/** 用語集へ追加する原語の入力値。 */
const source = ref('')
/** 用語集へ追加する訳語の入力値。 */
const translation = ref('')
/** 用語集へ追加する補足の入力値。 */
const note = ref('')

/** 検索条件に一致する用語集の項目。 */
const filteredEntries = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle)
    return props.entries
  return props.entries.filter(entry =>
    [entry.source, entry.translation, entry.note]
      .some(value => value.toLocaleLowerCase().includes(needle)),
  )
})

// 用語集を開くたびに検索と新規登録用の入力欄を初期化する。
watch(() => props.open, (open) => {
  if (!open)
    return
  query.value = ''
  source.value = ''
  translation.value = ''
  note.value = ''
})

/** 入力した用語を親へ渡し、追加用の入力欄を初期化する。 */
function addEntry() {
  if (!source.value.trim() || !translation.value.trim())
    return
  emit('add', source.value, translation.value, note.value)
  source.value = ''
  translation.value = ''
  note.value = ''
}

/** 編集した用語集項目を親へ渡す。 */
function updateEntry(entry: GlossaryEntry, field: 'source' | 'translation' | 'note', event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update', entry.id, {
    source: field === 'source' ? value : entry.source,
    translation: field === 'translation' ? value : entry.translation,
    note: field === 'note' ? value : entry.note,
  })
}
</script>

<template>
  <div v-if="open" class="confirmation-backdrop" @click.self="$emit('close')">
    <section
      class="glossary-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-title"
      @keydown.esc="$emit('close')"
    >
      <header class="glossary-header">
        <div>
          <h2 id="glossary-title">
            プロジェクト用語集
          </h2>
          <p class="muted">
            原文と訳語をプロジェクトに保存し、領域編集中に候補を表示します。
          </p>
        </div>
        <button type="button" aria-label="用語集を閉じる" @click="$emit('close')">
          閉じる
        </button>
      </header>

      <form class="glossary-add-form" @submit.prevent="addEntry">
        <label>原文<input v-model="source" required placeholder="Draw"></label>
        <label>訳語<input v-model="translation" required placeholder="引く"></label>
        <label>メモ（任意）<input v-model="note" placeholder="ゲーム固有の表記など"></label>
        <button type="submit" :disabled="!source.trim() || !translation.trim()">
          追加
        </button>
      </form>

      <label class="glossary-search">
        用語を検索
        <input v-model="query" type="search" placeholder="原文・訳語・メモ">
      </label>
      <p class="muted">
        {{ filteredEntries.length }} / {{ entries.length }}件
      </p>

      <div v-if="filteredEntries.length" class="glossary-list">
        <article v-for="entry in filteredEntries" :key="entry.id" class="glossary-entry">
          <label>原文<input :value="entry.source" @change="updateEntry(entry, 'source', $event)"></label>
          <label>訳語<input :value="entry.translation" @change="updateEntry(entry, 'translation', $event)"></label>
          <label>メモ<input :value="entry.note" @change="updateEntry(entry, 'note', $event)"></label>
          <button type="button" @click="$emit('remove', entry.id)">
            削除
          </button>
        </article>
      </div>
      <p v-else class="muted">
        {{ entries.length ? '一致する用語がありません。' : '用語はまだ登録されていません。' }}
      </p>
    </section>
  </div>
</template>
