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

  it('replaces a legacy sample setting with manual and preserves the endpoint across reloads', async () => {
    storage.set(TRANSLATION_SETTINGS_STORAGE_KEY, JSON.stringify({ provider: 'sample', endpoint }))
    const first = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(first.settings.value).toEqual({ provider: 'manual', endpoint })
    expect(JSON.parse(storage.get(TRANSLATION_SETTINGS_STORAGE_KEY)!)).toEqual({ provider: 'manual', endpoint })

    const reloaded = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(reloaded.settings.value).toEqual({ provider: 'manual', endpoint })
  })

  it.each(['manual', 'local'] as const)('keeps the saved %s provider and endpoint', async (provider) => {
    storage.set(TRANSLATION_SETTINGS_STORAGE_KEY, JSON.stringify({ provider, endpoint }))
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    await nextTick()
    expect(settings.settings.value).toEqual({ provider, endpoint })
  })

  it('persists an explicit change to normal translation settings', async () => {
    const settings = scope.run(useTranslationSettings)!
    hooks.mounted()
    settings.updateSettings({ provider: 'local', endpoint })
    await nextTick()
    expect(JSON.parse(storage.get(TRANSLATION_SETTINGS_STORAGE_KEY)!)).toEqual({ provider: 'local', endpoint })
  })
})
