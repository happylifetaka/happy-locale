import { describe, expect, it } from 'vitest'
import { historyShortcut } from '~/utils/keyboard'

function keyboardEvent(
  key: string,
  options: Partial<{
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }> = {},
  target?: EventTarget,
) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: target ?? null,
    ...options,
  }
}

describe('editor keyboard shortcuts', () => {
  it('blocks background undo and redo while a modal is open', () => {
    for (const event of [keyboardEvent('z', { metaKey: true }), keyboardEvent('z', { ctrlKey: true, shiftKey: true }), keyboardEvent('y', { ctrlKey: true })]) {
      expect(historyShortcut(event, true)).toBeNull()
      expect(historyShortcut(event, false)).not.toBeNull()
    }
  })
  it('recognizes undo and redo on macOS and other platforms', () => {
    expect(historyShortcut(keyboardEvent('z', { metaKey: true }))).toBe('undo')
    expect(
      historyShortcut(keyboardEvent('Z', { ctrlKey: true, shiftKey: true })),
    ).toBe('redo')
    expect(historyShortcut(keyboardEvent('y', { ctrlKey: true }))).toBe('redo')
  })

  it('does not intercept typing controls or unrelated shortcuts', () => {
    expect(
      historyShortcut(
        keyboardEvent('z', { metaKey: true }, {
          tagName: 'INPUT',
        } as unknown as EventTarget),
      ),
    ).toBeNull()
    expect(historyShortcut(keyboardEvent('z'))).toBeNull()
    expect(
      historyShortcut(keyboardEvent('z', { metaKey: true, altKey: true })),
    ).toBeNull()
  })
})
