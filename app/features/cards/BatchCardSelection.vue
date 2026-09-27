<script setup lang="ts">
import type { FolderProjectCard } from '~/types/editor'
import { computed, ref, watch } from 'vue'

const props = defineProps<{ cards: readonly FolderProjectCard[], selectedIds: readonly string[], eligibleIds: readonly string[], disabled: boolean, detection?: boolean }>()
const emit = defineEmits<{ select: [ids: string[]] }>()
const available = computed(() => props.cards.filter(card => props.eligibleIds.includes(card.id)))
type Preset = '' | 'all' | 'none' | 'uncreated'
const preset = ref<Preset>('')
const presets = computed(() => ({
  all: available.value.map(card => card.id),
  none: [] as string[],
  uncreated: available.value.filter(card => !card.regions.length).map(card => card.id),
}))
watch([presets, () => props.selectedIds, () => props.detection], () => {
  const selected = new Set(props.selectedIds.filter(id => props.eligibleIds.includes(id)))
  const matches = (value: Exclude<Preset, ''>) => (value !== 'uncreated' || props.detection)
    && presets.value[value].length === selected.size && presets.value[value].every(id => selected.has(id))
  if (preset.value && matches(preset.value))
    return
  const defaults: Exclude<Preset, ''>[] = props.detection && available.value.some(card => card.regions.length)
    ? ['uncreated', 'all', 'none']
    : ['all', 'none']
  preset.value = defaults.find(matches) ?? ''
}, { immediate: true, deep: true })
function selectPreset(event: Event) {
  const value = (event.target as HTMLSelectElement).value as Preset
  if (!value || props.disabled)
    return
  preset.value = value
  emit('select', [...presets.value[value]])
}
</script>

<template>
  <section class="batch-card-selection" aria-label="一括処理の対象">
    <strong>対象 {{ selectedIds.filter(id => eligibleIds.includes(id)).length }}枚</strong>
    <select :value="preset" aria-label="カードの選択条件" :disabled="disabled" @change="selectPreset">
      <option value="" disabled>
        未選択
      </option>
      <option value="all">
        全選択
      </option>
      <option value="none">
        選択解除
      </option>
      <option v-if="detection" value="uncreated">
        領域未作成のみ
      </option>
    </select>
    <small>チェックで選択・カードを押して確認</small>
  </section>
</template>

<style scoped>
.batch-card-selection { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 8px; padding: 10px 0; }
.batch-card-selection strong { grid-column: 2; grid-row: 1; font-size: 12px; white-space: nowrap; }
.batch-card-selection small { grid-column: 1 / -1; color: #64748b; font-size: 11px; }
.batch-card-selection select { grid-column: 1; grid-row: 1; width: 100%; min-width: 0; min-height: 36px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: inherit; font: inherit; font-size: 12px; }
</style>
