import type { InjectionKey } from 'vue'
import type { CardEditingContext, CardOCRContext, CardResourcesContext, CardSourceIconsContext, CardTranslationContext } from './cardEditingContracts'
import { inject, provide } from 'vue'

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

/** Workspaceだけが生成し、詳細Inspectorから確認を開くための局所的な窓口。 */
const sourceIcons = context<CardSourceIconsContext>('card source icons')
export const provideCardSourceIcons = sourceIcons.provide
export const useCardSourceIcons = sourceIcons.use
