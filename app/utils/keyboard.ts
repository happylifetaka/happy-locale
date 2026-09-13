export type HistoryShortcut = 'undo' | 'redo' | null

export interface KeyboardShortcutEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  target: EventTarget | null
}

/** キー入力先が文字を編集できる要素か判定する。 */
function isEditableTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object')
    return false
  const element = target as EventTarget & {
    isContentEditable?: boolean
    tagName?: string
  }
  return element.isContentEditable === true
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '')
}

/** 入力欄とモーダルのUndoをカード全体へ伝えず、エディターが扱える履歴操作だけを返す。 */
export function historyShortcut(event: KeyboardShortcutEvent, modalOpen = false): HistoryShortcut {
  if (modalOpen || isEditableTarget(event.target) || event.altKey)
    return null
  if (!(event.ctrlKey || event.metaKey))
    return null
  const key = event.key.toLowerCase()
  if (key === 'y' || (key === 'z' && event.shiftKey))
    return 'redo'
  return key === 'z' ? 'undo' : null
}
