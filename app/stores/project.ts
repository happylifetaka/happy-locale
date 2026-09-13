import type {
  CardProject,
  FolderProjectDocument,
  FontReference,
  GlossaryEntry,
  ImageAsset,
  OCRDictionaryEntry,
} from '~/types/editor'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { updateProjectCard } from '~/services/project/cards'

/** Vueの参照を含む保存可能なデータを独立した値へ複製する。 */
function clone<T>(value: T): T {
  return structuredClone(JSON.parse(JSON.stringify(value)) as T)
}

/** 画像と領域を持たない下書きカードを作る。 */
function emptyCardProject(): CardProject {
  return {
    imageName: '',
    imageWidth: 0,
    imageHeight: 0,
    regions: [],
  }
}

/** 文書から現在のカードの編集用データを取り出す。 */
function cardProjectFromDocument(
  document: FolderProjectDocument,
): CardProject {
  const card = document.cards.find(item => item.id === document.activeCardId)
  return card
    ? {
        imageName: card.imageName,
        imageWidth: card.imageWidth,
        imageHeight: card.imageHeight,
        regions: card.regions,
      }
    : emptyCardProject()
}

// 保存可能な編集データを管理する。画像・フォルダハンドル等の実体は useProjectRuntime に分離する。
export const useProjectStore = defineStore('project', () => {
  /** 現在のフォルダプロジェクトの保存用文書。初回保存前はnull。 */
  const document = shallowRef<FolderProjectDocument | null>(null)
  /** フォルダ文書がまだない段階のカード編集データ。 */
  const draftCard = shallowRef<CardProject>(emptyCardProject())
  /** 初回保存前に登録した共有アセット。 */
  const draftAssets = shallowRef<ImageAsset[]>([])
  /** 初回保存前に登録したフォント参照。 */
  const draftFonts = shallowRef<FontReference[]>([])
  /** 初回保存前に編集したOCR補正辞書。 */
  const draftOCRDictionary = shallowRef<OCRDictionaryEntry[]>([])
  /** 初回保存前に編集した用語集。 */
  const draftGlossary = shallowRef<GlossaryEntry[]>([])

  /** 文書があればそのアセット定義、なければ下書きの定義を返す。 */
  const assets = computed(() => document.value?.assets ?? draftAssets.value)
  /** 文書または下書きにある共有フォント参照。 */
  const fonts = computed(() => document.value?.fonts ?? draftFonts.value)
  /** 文書または下書きにあるOCR補正規則。 */
  const ocrDictionary = computed(
    () => document.value?.ocrDictionary ?? draftOCRDictionary.value,
  )
  /** 文書または下書きにある共有用語集。 */
  const glossary = computed(
    () => document.value?.glossary ?? draftGlossary.value,
  )
  /** 文書の選択カードまたは初回保存前の下書きカード。 */
  const activeCard = computed(() => document.value
    ? cardProjectFromDocument(document.value)
    : draftCard.value)

  /** カード切り替えを含む文書の差し替え入口。呼び出し元のオブジェクトとは参照を共有しない。 */
  function replaceProject(nextDocument: FolderProjectDocument) {
    document.value = clone(nextDocument)
    draftCard.value = emptyCardProject()
    draftAssets.value = []
    draftFonts.value = []
    draftOCRDictionary.value = []
    draftGlossary.value = []
  }

  /** 保存文書と下書きの共有設定を初期化する。 */
  function clearProject() {
    document.value = null
    draftCard.value = emptyCardProject()
    draftAssets.value = []
    draftFonts.value = []
    draftOCRDictionary.value = []
    draftGlossary.value = []
  }

  /** Saving acknowledges a snapshot; edits made while writing remain current. */
  function acceptSavedProject(saved: FolderProjectDocument, deletedIds: ReadonlySet<string>) {
    const savedPaths = new Map(saved.assets.map(asset => [asset.id, asset.imagePath]))
    const currentAssets = assets.value.map(asset => ({
      ...asset,
      imagePath: savedPaths.get(asset.id) ?? asset.imagePath,
    }))
    if (!document.value) {
      replaceProject({
        ...saved,
        cards: saved.cards.map(card => card.id === saved.activeCardId
          ? { ...card, ...draftCard.value }
          : card),
        assets: currentAssets,
        fonts: draftFonts.value,
        ocrDictionary: draftOCRDictionary.value,
        glossary: draftGlossary.value,
      })
      return
    }
    document.value = {
      ...document.value,
      cards: document.value.cards.filter(card => !deletedIds.has(card.id)),
      assets: currentAssets,
    }
  }

  /** フォルダ作成前は下書きへ、作成後は文書へ書き込み、共有設定の読み取り口を統一する。 */
  function updateSharedState<K extends 'assets' | 'fonts' | 'ocrDictionary' | 'glossary'>(
    key: K,
    value: FolderProjectDocument[K],
  ) {
    const nextValue = clone(value)
    if (document.value) {
      document.value = {
        ...document.value,
        [key]: nextValue,
      }
      return
    }
    if (key === 'assets')
      draftAssets.value = nextValue as ImageAsset[]
    else if (key === 'fonts')
      draftFonts.value = nextValue as FontReference[]
    else if (key === 'ocrDictionary')
      draftOCRDictionary.value = nextValue as OCRDictionaryEntry[]
    else
      draftGlossary.value = nextValue as GlossaryEntry[]
  }

  /** 共有アセットの保存用定義を更新する。 */
  function setAssets(nextAssets: ImageAsset[]) {
    updateSharedState('assets', nextAssets)
  }

  /** 共有フォントの保存用参照を更新する。 */
  function setFonts(nextFonts: FontReference[]) {
    updateSharedState('fonts', nextFonts)
  }

  /** 共有OCR補正辞書を更新する。 */
  function setOCRDictionary(nextDictionary: OCRDictionaryEntry[]) {
    updateSharedState('ocrDictionary', nextDictionary)
  }

  /** 共有用語集を更新する。 */
  function setGlossary(nextGlossary: GlossaryEntry[]) {
    updateSharedState('glossary', nextGlossary)
  }

  /** カードIDに対応する編集データを文書または下書きへ反映する。 */
  function updateCard(cardId: string | null, project: CardProject) {
    if (!document.value) {
      draftCard.value = clone(project)
      return
    }
    if (!cardId || !document.value.cards.some(card => card.id === cardId))
      return
    document.value = updateProjectCard(document.value, cardId, project)
  }

  /** フォルダプロジェクト文書を独立した複製として返す。文書がなければnullを返す。 */
  function snapshot() {
    return document.value ? clone(document.value) : null
  }

  return {
    document,
    draftCard,
    draftAssets,
    draftFonts,
    draftOCRDictionary,
    draftGlossary,
    assets,
    fonts,
    ocrDictionary,
    glossary,
    activeCard,
    replaceProject,
    acceptSavedProject,
    clearProject,
    setAssets,
    setFonts,
    setOCRDictionary,
    setGlossary,
    updateCard,
    snapshot,
  }
})
