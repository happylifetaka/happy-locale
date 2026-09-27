import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { TRANSLATION_SETTINGS_STORAGE_KEY, useTranslationSettings } from '~/composables/useTranslationSettings'

const hooks = vi.hoisted(() => ({ mounted: () => {} }))
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted = callback,
}))

describe('saved translation settings', () => {
  let scope: ReturnType<typeof effectScope>
  let storage: Map<string, string>
  const endpoint = 'http://localhost:9000'

  beforeEach(() => {
    scope = effectScope()
    storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
  })

  it('offers manual for a legacy sample setting without treating demo settings as configured', async () => {
    storage.set(TRANSLATION_SETTINGS_STORAGE_KEY, JSON.stringify({ provider: 'sample', endpoint }))
    const first = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(first.settings.value).toEqual({ provider: 'manual', endpoint })
    expect(first.configured.value).toBe(false)
    expect(JSON.parse(storage.get(TRANSLATION_SETTINGS_STORAGE_KEY)!)).toEqual({ provider: 'sample', endpoint })

    const reloaded = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(reloaded.settings.value).toEqual({ provider: 'manual', endpoint })
    expect(reloaded.configured.value).toBe(false)
  })

  it.each(['manual', 'local', 'browser'] as const)('keeps the saved %s provider and endpoint', async (provider) => {
    storage.set(TRANSLATION_SETTINGS_STORAGE_KEY, JSON.stringify({ provider, endpoint }))
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(settings.settings.value).toEqual({ provider, endpoint })
    expect(settings.configured.value).toBe(true)
  })

  it('persists an explicit change to normal translation settings', async () => {
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    settings.updateSettings({ provider: 'local', endpoint })
    await nextTick()
    expect(JSON.parse(storage.get(TRANSLATION_SETTINGS_STORAGE_KEY)!)).toEqual({ provider: 'local', endpoint })
    expect(settings.configured.value).toBe(true)
  })

  it.each([null, '{broken', '{}', '{"provider":"unknown","endpoint":""}'])('does not persist defaults or finish setup for %s', async (value) => {
    if (value !== null)
      storage.set(TRANSLATION_SETTINGS_STORAGE_KEY, value)
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(settings.configured.value).toBe(false)
    expect(settings.settings.value.provider).toBe('manual')
    expect(storage.get(TRANSLATION_SETTINGS_STORAGE_KEY) ?? null).toBe(value)
  })

  it('persists explicit manual selection and recognizes it on the next visit', async () => {
    const first = scope.run(useTranslationSettings)!
    hooks.mounted()
    first.updateSettings(first.settings.value)
    await nextTick()
    const next = scope.run(useTranslationSettings)!
    hooks.mounted()
    expect(next.configured.value).toBe(true)
    expect(next.settings.value.provider).toBe('manual')
  })

  it('allows setup for this visit when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    expect(settings.configured.value).toBe(false)
    settings.updateSettings({ provider: 'browser', endpoint })
    await nextTick()
    expect(settings.configured.value).toBe(true)
  })
})
