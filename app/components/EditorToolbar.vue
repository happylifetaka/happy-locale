<script setup lang="ts">
import { consumeSelectedFile } from '~/utils/file-input'

const props = defineProps<{
  hasCardImage: boolean
  canUndo: boolean
  canRedo: boolean
  folderProjectsSupported: boolean
  hasOpenProject: boolean
  hasSavedProject: boolean
  isDemo?: boolean
  saveStatus: 'none' | 'saved' | 'unsaved'
  currentView: 'card' | 'assets' | 'print'
  diagnosticCount: number
}>()

const emit = defineEmits<{
  openProject: []
  saveProject: []
  importCsv: [file: File]
  exportCsv: []
  undo: []
  redo: []
  diagnostic: [message: string]
  view: [value: 'card' | 'assets']
  openTranslationSettings: []
  openGlossary: []
  openDiagnostics: []
}>()

/** 翻訳CSVを選ぶための入力要素。 */
const csvInput = ref<HTMLInputElement | null>(null)
/** ツールメニューの開閉を制御するdetails要素。 */
const toolsMenu = ref<HTMLDetailsElement | null>(null)
const saveTooltipId = useId()
/** 保存できない理由を表示するツールチップの画面座標。 */
const saveTooltipPosition = ref<{ left: number, top: number } | null>(null)

/** 無効ボタンでも理由を示せるよう、通常のクリック操作とは別にツールチップの位置を計算する。 */
function showSaveTooltip(event: Event) {
  if (!props.isDemo)
    return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  saveTooltipPosition.value = {
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - 328)),
    top: bounds.bottom + 8,
  }
}

/** 保存ボタンの説明表示を解除する。 */
function hideSaveTooltip() {
  saveTooltipPosition.value = null
}

// スクロールやリサイズで位置がずれる前に保存理由の表示を隠す。
onMounted(() => {
  window.addEventListener('scroll', hideSaveTooltip, true)
  window.addEventListener('resize', hideSaveTooltip)
})
// 画面終了時にツールチップ用の位置変更イベントを解除する。
onUnmounted(() => {
  window.removeEventListener('scroll', hideSaveTooltip, true)
  window.removeEventListener('resize', hideSaveTooltip)
})

/** ツールメニューを閉じる。 */
function closeToolsMenu() {
  toolsMenu.value?.removeAttribute('open')
}

/** メニュー外のポインター操作でツールメニューを閉じる。 */
function closeToolsMenuFromOutside(event: PointerEvent) {
  if (!toolsMenu.value?.contains(event.target as Node))
    closeToolsMenu()
}

// ツールメニュー外のクリックを監視する。
onMounted(() => document.addEventListener('pointerdown', closeToolsMenuFromOutside))
// ツールバー終了時に外側クリックの監視を解除する。
onUnmounted(() => document.removeEventListener('pointerdown', closeToolsMenuFromOutside))

/** 選択したCSVを読み込み用に親へ渡す。 */
function pickCsv(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  emit(
    'diagnostic',
    file
      ? 'CSV選択イベントを受け取りました'
      : 'CSV選択にファイルがありません',
  )
  if (file)
    emit('importCsv', file)
}
</script>

<template>
  <header class="toolbar">
    <WorkspaceSwitcher />
    <div v-if="hasOpenProject" class="toolbar-group toolbar-navigation">
      <nav class="editor-tabs" aria-label="カード編集の画面">
        <button
          type="button"
          :class="{ selected: currentView === 'card' }"
          @click="$emit('view', 'card')"
        >
          カード
        </button>
        <button
          type="button"
          :class="{ selected: currentView === 'assets' }"
          :disabled="!hasOpenProject"
          @click="$emit('view', 'assets')"
        >
          アセット編集
        </button>
      </nav>
    </div>
    <div v-if="!hasOpenProject" class="toolbar-group">
      <button
        type="button"
        class="primary"
        :disabled="!folderProjectsSupported"
        title="既存プロジェクト、または新規作成用の空フォルダを選択します"
        @click="$emit('openProject')"
      >
        プロジェクトを開く／作成
      </button>
    </div>
    <div v-else class="toolbar-group">
      <span
        class="project-save-control"
        :class="{ 'is-demo': isDemo }"
        :tabindex="isDemo ? 0 : undefined"
        :aria-label="isDemo ? 'プロジェクト保存：デモではプロジェクトを保存できません' : undefined"
        :aria-describedby="isDemo && saveTooltipPosition ? saveTooltipId : undefined"
        @pointerenter="showSaveTooltip"
        @pointerleave="hideSaveTooltip"
        @focus="showSaveTooltip"
        @blur="hideSaveTooltip"
        @keydown.esc.stop="hideSaveTooltip"
      >
        <button
          type="button"
          :disabled="isDemo || !hasCardImage || !folderProjectsSupported"
          :title="isDemo ? undefined : hasSavedProject
            ? '編集中のプロジェクトへ保存します'
            : '選択したフォルダへ新しいプロジェクトを作成します'"
          @click="$emit('saveProject')"
        >
          プロジェクト保存
        </button>
      </span>
      <span
        v-if="hasOpenProject && saveStatus !== 'none'"
        class="save-status"
        :class="saveStatus"
        role="status"
      >
        {{ saveStatus === 'saved' ? '保存済み' : '未保存の変更あり' }}
      </span>
    </div>
    <div v-if="hasOpenProject && currentView === 'card'" class="toolbar-group">
      <button type="button" :disabled="!canUndo" @click="$emit('undo')">
        元に戻す
      </button>
      <button type="button" :disabled="!canRedo" @click="$emit('redo')">
        やり直す
      </button>
    </div>
    <details ref="toolsMenu" class="toolbar-tools" @keydown.esc="closeToolsMenu">
      <summary class="button">
        ツール
      </summary>
      <div class="toolbar-tools-menu" @click="closeToolsMenu">
        <button
          v-if="hasOpenProject"
          type="button"
          :disabled="!folderProjectsSupported"
          @click="$emit('openProject')"
        >
          別のプロジェクトを開く
        </button>
        <button
          v-if="hasOpenProject"
          type="button"
          :disabled="!hasCardImage || currentView !== 'card'"
          @click="csvInput?.click()"
        >
          翻訳CSVを読み込む
        </button>
        <button
          v-if="hasOpenProject"
          type="button"
          :disabled="!hasCardImage || currentView !== 'card'"
          @click="$emit('exportCsv')"
        >
          翻訳CSVを保存
        </button>
        <button
          v-if="hasOpenProject"
          type="button"
          :disabled="!hasCardImage || currentView !== 'card'"
          @click="$emit('openGlossary')"
        >
          用語集を編集
        </button>
        <button
          v-if="hasOpenProject"
          type="button"
          @click="$emit('openTranslationSettings')"
        >
          翻訳設定
        </button>
        <button type="button" @click="$emit('openDiagnostics')">
          診断ログ（{{ diagnosticCount }}件）
        </button>
      </div>
    </details>
    <input
      ref="csvInput"
      class="visually-hidden"
      type="file"
      accept=".csv,text/csv"
      @change="pickCsv"
    >
  </header>
  <Teleport to="body">
    <span
      v-if="isDemo && saveTooltipPosition"
      :id="saveTooltipId"
      role="tooltip"
      class="project-save-tooltip"
      :style="{ left: `${saveTooltipPosition.left}px`, top: `${saveTooltipPosition.top}px` }"
    >
      デモではプロジェクトを保存できません
    </span>
  </Teleport>
</template>
