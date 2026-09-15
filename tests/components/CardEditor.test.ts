// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { editorRuntime, mountEditor, unmountEditor } from './helpers/card-editor'

describe('card editor preview deferral', () => {
  it('keeps edits live during IME composition and redraws 500ms after input ends', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', true)
    inspector.vm.$emit('update', inspector.props('region').id, { translatedText: '編集中' })
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    expect(canvas.props('project').regions[0].translatedText).toBe('編集中')
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)

    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(499)
    expect(canvas.props('previewDeferred')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(canvas.props('previewDeferred')).toBe(false)
  })

  it('restarts the delay on new input and cancels it when composition resumes', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('defer-preview', true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('flush-preview')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['region', 'view', 'tab', 'image'] as const)('flushes a pending preview when %s changes', async (change) => {
    const { wrapper, canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    if (change === 'region')
      canvas.vm.$emit('select-region', null)
    else if (change === 'view')
      wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('view', 'assets')
    else if (change === 'tab')
      await wrapper.get('#inspector-tab-text').trigger('click')
    else
      editorRuntime().cardImage.value = document.createElement('img')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its pending timer when the editor is unmounted', async () => {
    const { inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    expect(vi.getTimerCount()).toBe(1)
    unmountEditor()
    expect(vi.getTimerCount()).toBe(0)
  })
})
