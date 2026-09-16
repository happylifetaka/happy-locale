import type { useProjectStore } from '~/stores/project'
import type { GlossaryEntry } from '~/types/editor'
import { glossaryKey } from '~/utils/glossary'

interface EditorGlossaryOptions {
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'glossary' | 'setGlossary'>
  setMessage: (message: string) => void
}

/** 用語集入力の検証と共有設定への更新を管理する。 */
export function useEditorGlossary({ projectStore, setMessage }: EditorGlossaryOptions) {
  /** 用語集へ原語・訳語・補足を追加する。 */
  function addGlossaryEntry(source: string, translation: string, note: string) {
    const normalizedSource = source.trim()
    const normalizedTranslation = translation.trim()
    if (!normalizedSource || !normalizedTranslation)
      return
    if (projectStore.glossary.some(entry => glossaryKey(entry.source) === glossaryKey(normalizedSource))) {
      setMessage(`用語「${normalizedSource}」は既に登録されています。`)
      return
    }
    projectStore.setGlossary([...projectStore.glossary, {
      id: crypto.randomUUID(),
      source: normalizedSource,
      translation: normalizedTranslation,
      note: note.trim(),
    }])
  }

  /** 指定した用語集項目の内容を変更する。 */
  function updateGlossaryEntry(
    id: string,
    patch: Pick<GlossaryEntry, 'source' | 'translation' | 'note'>,
  ) {
    const source = patch.source.trim()
    const translation = patch.translation.trim()
    if (!source || !translation) {
      setMessage('用語の原文と訳語は空にできません。')
      return
    }
    if (projectStore.glossary.some(entry =>
      entry.id !== id && glossaryKey(entry.source) === glossaryKey(source),
    )) {
      setMessage(`用語「${source}」は既に登録されています。`)
      return
    }
    projectStore.setGlossary(projectStore.glossary.map(entry => entry.id === id
      ? { ...entry, source, translation, note: patch.note.trim() }
      : entry))
  }

  /** 指定した用語集項目を取り除く。 */
  function removeGlossaryEntry(id: string) {
    projectStore.setGlossary(projectStore.glossary.filter(entry => entry.id !== id))
  }

  return { addGlossaryEntry, updateGlossaryEntry, removeGlossaryEntry }
}
