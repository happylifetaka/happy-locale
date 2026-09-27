<script setup lang="ts">
import type { TextRegion } from '~/types/editor'
import type { RegionStatusFilter } from '~/utils/region-filter'
import { computed, nextTick, ref, watch } from 'vue'
import { filterRegions } from '~/utils/region-filter'

const props = defineProps<{
  regions: TextRegion[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  move: [id: string, targetId: string, position: 'before' | 'after']
  select: [id: string]
  rename: [id: string, displayName: string]
  remove: [id: string]
  split: [id: string]
  merge: [id: string]
}>()

/** 一覧を絞り込む検索文字列。 */
const query = ref('')
/** 領域一覧の翻訳状態フィルター。 */
const status = ref<RegionStatusFilter>('all')
/** 表示名を編集中の領域ID。 */
const editingRegionId = ref<string | null>(null)
/** 確定前の領域表示名。 */
const displayNameDraft = ref('')
/** 改名開始時にフォーカスを移す入力要素。 */
const renameInput = ref<HTMLInputElement | null>(null)
/** 検索語と翻訳状態に一致する領域一覧。 */
const filteredRegions = computed(() =>
  filterRegions(props.regions, query.value, status.value),
)

const draggedId = ref<string | null>(null)
const dropTarget = ref<{ id: string, position: 'before' | 'after' } | null>(null)

function clearDrag() {
  draggedId.value = null
  dropTarget.value = null
}

watch([() => props.regions, query, status], clearDrag)

function startDrag(event: DragEvent, id: string) {
  if (editingRegionId.value || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  draggedId.value = id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', id)
}

function dragOver(event: DragEvent, id: string) {
  if (!draggedId.value || draggedId.value === id)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' }
}

function drop(event: DragEvent, id: string) {
  dragOver(event, id)
  if (draggedId.value && dropTarget.value?.id === id && draggedId.value !== id)
    emit('move', draggedId.value, id, dropTarget.value.position)
  clearDrag()
}

function moveWithKeyboard(event: KeyboardEvent, id: string) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    return
  event.preventDefault()
  const index = filteredRegions.value.findIndex(region => region.id === id)
  const target = filteredRegions.value[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (target)
    emit('move', id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
}

/** 表示名の現在値を下書きへ移して改名を開始する。 */
function startRename(region: TextRegion) {
  editingRegionId.value = region.id
  displayNameDraft.value = region.displayName
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

/** 表示名の下書きを破棄して改名を終了する。 */
function cancelRename() {
  editingRegionId.value = null
  displayNameDraft.value = ''
}

/** 入力した領域名を親へ通知して改名を終了する。 */
function commitRename(region: TextRegion) {
  if (editingRegionId.value !== region.id)
    return
  const displayName = displayNameDraft.value.trim()
  cancelRename()
  if (displayName && displayName !== region.displayName)
    emit('rename', region.id, displayName)
}
</script>

<template>
  <section v-if="regions.length" class="region-list">
    <h3>領域一覧 ({{ regions.length }})</h3>
    <div class="region-list-filters">
      <input
        v-model="query"
        type="search"
        aria-label="領域を検索"
        placeholder="原文・訳文を検索"
      >
      <select v-model="status" aria-label="翻訳ステータスで絞り込み">
        <option value="all">
          すべて
        </option>
        <option value="untranslated">
          未翻訳
        </option>
        <option value="draft">
          下書き
        </option>
        <option value="reviewed">
          確認済み
        </option>
      </select>
    </div>
    <p v-if="filteredRegions.length === 0" class="muted">
      条件に一致する領域はありません。
    </p>
    <div
      v-for="region in filteredRegions"
      :key="region.id"
      class="region-list-item"
      :class="{
        'selected': region.id === selectedId,
        'region-list-dragging': draggedId === region.id,
        'region-list-drop-before': dropTarget?.id === region.id && dropTarget.position === 'before',
        'region-list-drop-after': dropTarget?.id === region.id && dropTarget.position === 'after',
      }"
      @dragover="dragOver($event, region.id)"
      @dragleave="dropTarget = null"
      @drop="drop($event, region.id)"
    >
      <button
        type="button"
        class="region-list-drag-handle"
        :draggable="editingRegionId === null"
        :disabled="regions.length < 2 || editingRegionId !== null"
        :aria-label="`${region.displayName.trim() || region.regionId}を並び替え`"
        title="ドラッグで並び替え（上下矢印キーでも移動できます）"
        @dragstart="startDrag($event, region.id)"
        @dragend="clearDrag"
        @keydown="moveWithKeyboard($event, region.id)"
      >
        ⠿
      </button>
      <button
        type="button"
        class="region-list-select"
        @click="$emit('select', region.id)"
      >
        <strong :class="{ 'region-list-name-placeholder': editingRegionId === region.id }">
          {{ region.displayName.trim() || region.regionId }}
        </strong>
        <small
          v-if="editingRegionId !== region.id"
          :class="`translation-status-${region.translationStatus}`"
        >
          {{
            region.translationStatus === 'reviewed'
              ? '確認済み'
              : region.translationStatus === 'draft' ? '下書き' : '未翻訳'
          }}
        </small>
        <span>{{
          region.translatedText || region.originalText || region.regionId
        }}</span>
      </button>
      <input
        v-if="editingRegionId === region.id"
        ref="renameInput"
        v-model="displayNameDraft"
        class="region-list-name-input"
        aria-label="領域名"
        @click.stop
        @keydown.enter.prevent="commitRename(region)"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename(region)"
      >
      <span class="region-list-actions">
        <button
          v-if="editingRegionId !== region.id"
          type="button"
          class="region-list-rename"
          :aria-label="`${region.displayName.trim() || region.regionId}の名前を変更`"
          title="名前変更"
          @click="startRename(region)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" />
            <path d="m13.5 7 3.5 3.5" />
          </svg>
        </button>
        <button
          type="button"
          class="region-list-remove"
          :aria-label="`${region.displayName.trim() || region.regionId}を削除`"
          title="削除"
          @click="$emit('remove', region.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
          </svg>
        </button>
        <button
          type="button"
          class="region-list-split"
          :aria-label="`${region.displayName.trim() || region.regionId}を分割`"
          title="分割"
          @click="emit('split', region.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 4H3v16h6M15 4h6v16h-6" />
            <path d="M12 3v3m0 4v4m0 4v3" stroke-dasharray="2 2" />
            <path d="m7 10-2 2 2 2m-2-2h4m8-2 2 2-2 2m2-2h-4" />
          </svg>
        </button>
        <button
          type="button"
          class="region-list-merge"
          :disabled="regions.length < 2"
          :aria-label="`${region.displayName.trim() || region.regionId}を結合`"
          title="結合"
          @click="emit('merge', region.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M5 12h5m-2-2 2 2-2 2m11-2h-5m2-2-2 2 2 2" />
          </svg>
        </button>
      </span>
    </div>
  </section>
</template>

<style scoped>
.region-list .region-list-select { padding-left: 2rem; }
.region-list-name-input { left: 2rem; }
.region-list .region-list-drag-handle {
  position: absolute;
  top: 0.65rem;
  left: 0.2rem;
  padding: 0.2rem;
  border: 0;
  background: transparent;
  color: #64748b;
  cursor: grab;
  font-size: 1.2rem;
}
.region-list-dragging { opacity: 0.45; }
.region-list-drop-before::before,
.region-list-drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: #3970d5;
  pointer-events: none;
}
.region-list-drop-before::before { top: -4px; }
.region-list-drop-after::after { bottom: -4px; }
</style>
