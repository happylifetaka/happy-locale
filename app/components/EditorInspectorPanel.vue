<script setup lang="ts">
import { nextTick } from 'vue'

export type InspectorDetailTab = 'region' | 'ocr' | 'text'
export type InspectorTab = 'list' | 'print' | InspectorDetailTab

const props = defineProps<{
  activeTab: InspectorTab
  canOpenTab: (tab: InspectorTab) => boolean
  selectionLabel: string | null
}>()
const emit = defineEmits<{ select: [tab: InspectorTab] }>()
/** 右側の設定タブの表示順とラベル。 */
const inspectorTabs: Array<{ id: InspectorTab, label: string }> = [
  { id: 'list', label: '領域一覧' },
  { id: 'region', label: '領域' },
  { id: 'ocr', label: 'OCR' },
  { id: 'text', label: '翻訳' },
  { id: 'print', label: '印刷\n範囲' },
]
/** 矢印キー等によるタブ移動とフォーカス変更を処理する。 */
function moveInspectorTab(event: KeyboardEvent, currentIndex: number) {
  const enabledTabs = inspectorTabs.filter(tab => props.canOpenTab(tab.id))
  const current = enabledTabs.findIndex(
    tab => tab.id === inspectorTabs[currentIndex]?.id,
  )
  let nextIndex: number | null = null
  if (event.key === 'ArrowRight')
    nextIndex = (current + 1) % enabledTabs.length
  else if (event.key === 'ArrowLeft')
    nextIndex = (current - 1 + enabledTabs.length) % enabledTabs.length
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = enabledTabs.length - 1
  if (nextIndex === null)
    return
  event.preventDefault()
  const nextTab = enabledTabs[nextIndex]
  if (!nextTab)
    return
  emit('select', nextTab.id)
  const tablist = (event.currentTarget as HTMLElement).parentElement
  nextTick(() => tablist
    ?.querySelector<HTMLButtonElement>(`#inspector-tab-${nextTab.id}`)
    ?.focus())
}
</script>

<template>
  <aside class="side-panel">
    <slot name="header" />
    <div class="side-panel-tabs" role="tablist" aria-label="領域の管理と編集">
      <button
        v-for="(tab, index) in inspectorTabs"
        :id="`inspector-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`inspector-panel-${tab.id}`"
        :class="{ selected: activeTab === tab.id }"
        :disabled="!canOpenTab(tab.id)"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="$emit('select', tab.id)"
        @keydown="moveInspectorTab($event, index)"
      >
        <span>{{ tab.label }}</span>
      </button>
    </div>
    <p
      v-if="selectionLabel && activeTab !== 'list'"
      class="side-panel-selection"
    >
      <span>選択中</span>
      <strong>{{ selectionLabel }}</strong>
    </p>
    <slot />
  </aside>
</template>
