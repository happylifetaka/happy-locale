import { onBeforeUnmount, onMounted } from 'vue'
import { historyShortcut } from '~/utils/keyboard'

interface EditorHistoryShortcutsOptions {
  enabled: () => boolean
  undo: () => void
  redo: () => void
}

/** 入力欄・モーダルの履歴を横取りせず、マウント中だけカードの履歴操作へ接続する。 */
export function useEditorHistoryShortcuts(options: EditorHistoryShortcutsOptions) {
  function handleKeydown(event: KeyboardEvent) {
    if (!options.enabled())
      return
    const modalOpen = Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
    const shortcut = historyShortcut(event, modalOpen)
    if (!shortcut)
      return
    event.preventDefault()
    if (shortcut === 'undo')
      options.undo()
    else
      options.redo()
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}
