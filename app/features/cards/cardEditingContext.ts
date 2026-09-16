import type { InjectionKey, Ref } from 'vue'
import type { useCardWorkspace } from './useCardWorkspace'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { OCRExecutionState, useEditorOCR } from '~/composables/useEditorOCR'
import type { useRegionCandidates } from '~/composables/useRegionCandidates'
import type { FontReference, GlossaryEntry, ImageAsset, OCRDictionaryEntry } from '~/types/editor'
import { inject, provide } from 'vue'

/** 保存・カード切替を公開せず、既存の編集インスタンスへの操作だけを共有する。 */
interface CardEditingContext {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegion' | 'selectedRegionId' | 'updateRegion'>
  workspace: Omit<ReturnType<typeof useCardWorkspace>, 'stopEditing' | 'resetCardSelection' | 'maskEditing' | 'exclusionEditing'>
}

/** runtimeが所有する描画資源への参照。解放・保存用のAPIは渡さない。 */
interface CardResourcesContext {
  image: Readonly<Ref<HTMLImageElement | null>>
  projectSelected: Readonly<Ref<boolean>>
  assets: Readonly<Ref<ImageAsset[]>>
  assetImages: Readonly<Ref<ReadonlyMap<string, CanvasImageSource>>>
  fontFamilies: Readonly<Ref<ReadonlyMap<string, string>>>
  fonts: Readonly<Ref<FontReference[]>>
  loadedFontIds: Readonly<Ref<ReadonlySet<string>>>
}

interface CardOCRContext {
  region: Omit<ReturnType<typeof useEditorOCR>, 'clearOCRCandidate'>
  execution: OCRExecutionState
  dictionary: Readonly<Ref<OCRDictionaryEntry[]>>
  candidates: Pick<ReturnType<typeof useRegionCandidates>, 'regionCandidates' | 'selectedCandidateId' | 'selectRegionCandidate' | 'updateCandidateBounds'>
  requestSourceIcons: () => void
}

interface CardTranslationContext {
  enabled: Readonly<Ref<boolean>>
  running: Readonly<Ref<boolean>>
  glossary: Readonly<Ref<GlossaryEntry[]>>
  reusableCount: Readonly<Ref<number>>
  requestReuse: () => void
  translate: () => void
}

function context<T>(name: string) {
  const key: InjectionKey<T> = Symbol(name)
  return {
    provide(value: T) { provide(key, value) },
    use(): T {
      const value = inject(key)
      if (!value)
        throw new Error(`${name} must be provided by CardEditor`)
      return value
    },
  }
}

const editing = context<CardEditingContext>('card editing')
const resources = context<CardResourcesContext>('card resources')
const ocr = context<CardOCRContext>('card OCR')
const translation = context<CardTranslationContext>('card translation')
export const provideCardEditing = editing.provide
export const useCardEditing = editing.use
export const provideCardResources = resources.provide
export const useCardResources = resources.use
export const provideCardOCR = ocr.provide
export const useCardOCR = ocr.use
export const provideCardTranslation = translation.provide
export const useCardTranslation = translation.use
