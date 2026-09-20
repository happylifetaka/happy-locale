import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type {
  CardProject,
  FolderProjectDocument,
  FontReference,
  GlossaryEntry,
  ImageAsset,
  OCRDictionaryEntry,
} from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { parseAssetDiscovery } from '~/services/asset-discovery/format'
import { invalidateDiscoveryImage, reconcileDiscoveryContent, reconcileOccurrenceOwners, removeDiscoveryAssets } from '~/services/asset-discovery/review'
import { cloneRegionCandidates } from '~/services/ocr/candidates'
import { finalizeProjectCardDeletions, reconcileProjectDiscoveryOwners, updateProjectCard } from '~/services/project/cards'

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
  const draftOCRCandidates = shallowRef<RegionCandidate[]>([])
  const draftAssetDiscovery = shallowRef<AssetDiscoveryState | undefined>()
  const draftDiscoveryCardId = shallowRef<string | null>(null)
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
  const assetDiscovery = computed(() => document.value ? document.value.assetDiscovery : draftAssetDiscovery.value)
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
    const discovery = nextDocument.assetDiscovery !== undefined
      ? parseAssetDiscovery(nextDocument.assetDiscovery, { cards: nextDocument.cards, assetIds: new Set(nextDocument.assets.map(asset => asset.id)) })
      : undefined
    // setAssetDiscoveryと同じ正規形を保持し、無変更操作やUndoで保存署名が変わらないようにする。
    document.value = clone(discovery ? { ...nextDocument, assetDiscovery: discovery } : nextDocument)
    draftCard.value = emptyCardProject()
    draftOCRCandidates.value = []
    draftAssetDiscovery.value = undefined
    draftDiscoveryCardId.value = null
    draftAssets.value = []
    draftFonts.value = []
    draftOCRDictionary.value = []
    draftGlossary.value = []
  }

  /** 保存文書と下書きの共有設定を初期化する。 */
  function clearProject() {
    document.value = null
    draftCard.value = emptyCardProject()
    draftOCRCandidates.value = []
    draftAssetDiscovery.value = undefined
    draftDiscoveryCardId.value = null
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
          ? { ...card, ...draftCard.value, ocrCandidates: draftOCRCandidates.value.length ? cloneRegionCandidates(draftOCRCandidates.value) : undefined }
          : card),
        assets: currentAssets,
        fonts: draftFonts.value,
        ocrDictionary: draftOCRDictionary.value,
        glossary: draftGlossary.value,
        assetDiscovery: draftAssetDiscovery.value,
      })
      return
    }
    document.value = {
      ...finalizeProjectCardDeletions(document.value, deletedIds).document,
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
    const nextIds = new Set(nextAssets.map(asset => asset.id))
    const deletedIds = new Set(assets.value.filter(asset => !nextIds.has(asset.id)).map(asset => asset.id))
    const state = assetDiscovery.value
    const updated = state && deletedIds.size ? removeDiscoveryAssets(state, deletedIds) : state
    // 共有定義を変更する前に検証し、参照の修復失敗で片側だけ更新しない。
    const nextState = updated && updated !== state
      ? parseAssetDiscovery(updated, {
          cards: document.value?.cards ?? [{ ...draftCard.value, id: draftDiscoveryCardId.value!, ocrCandidates: draftOCRCandidates.value }],
          assetIds: nextIds,
        })
      : updated
    updateSharedState('assets', nextAssets)
    if (nextState !== state) {
      if (document.value)
        document.value = { ...document.value, assetDiscovery: nextState }
      else draftAssetDiscovery.value = nextState
    }
  }

  /** 候補レビューを検証して独立保存する。通常領域や原文は変更しない。 */
  function setAssetDiscovery(state: AssetDiscoveryState | null, cardId?: string) {
    const draftId = cardId ?? draftDiscoveryCardId.value
    if (state && !document.value && !draftId)
      throw new Error('アイコン候補を保存するカードを指定してください。')
    const cards = document.value?.cards ?? [{ ...draftCard.value, id: draftId!, ocrCandidates: draftOCRCandidates.value }]
    const next = state ? parseAssetDiscovery(state, { cards, assetIds: new Set(assets.value.map(asset => asset.id)) }) : undefined
    if (document.value) {
      document.value = { ...document.value, assetDiscovery: next }
    }
    else {
      draftAssetDiscovery.value = next
      draftDiscoveryCardId.value = next ? draftId : null
    }
  }

  /** 新しい領域IDへの昇格と参照の解除だけを行い、承認内容は書き換えない。 */
  function reconcileDiscoveryOwners(cardId: string, promotedIds: ReadonlyMap<string, string> = new Map()) {
    if (document.value) {
      document.value = reconcileProjectDiscoveryOwners(document.value, cardId, promotedIds)
      return
    }
    if (!draftAssetDiscovery.value || cardId !== draftDiscoveryCardId.value)
      return
    draftAssetDiscovery.value = {
      ...draftAssetDiscovery.value,
      occurrences: reconcileOccurrenceOwners(draftAssetDiscovery.value.occurrences, cardId, [
        ...draftCard.value.regions.map(region => ({ ...region, kind: 'region' as const })),
        ...draftOCRCandidates.value.map(candidate => ({ ...candidate, kind: 'candidate' as const })),
      ], promotedIds),
    }
  }

  /** 寸法が同じでも、新しい画像を明示的に採用した際は古い承認・所属を流用しない。 */
  function invalidateAssetDiscoveryImage(cardId: string) {
    if (document.value?.assetDiscovery)
      document.value = { ...document.value, assetDiscovery: invalidateDiscoveryImage(document.value.assetDiscovery, cardId) }
    else if (!document.value && draftAssetDiscovery.value && draftDiscoveryCardId.value === cardId)
      draftAssetDiscovery.value = invalidateDiscoveryImage(draftAssetDiscovery.value, cardId)
  }

  /** runtimeで実際に読み終えた内容ハッシュを適用する。画像そのものはStoreに持ち込まない。 */
  function reconcileAssetDiscoveryContent(imageDigests: ReadonlyMap<string, string | null>, assetDigests: ReadonlyMap<string, string | null>) {
    const current = assetDiscovery.value
    if (!current)
      return false
    const next = reconcileDiscoveryContent(current, imageDigests, assetDigests)
    if (next === current)
      return false
    setAssetDiscovery(next)
    return true
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
      if (draftAssetDiscovery.value && draftDiscoveryCardId.value
        && (draftCard.value.imageWidth !== project.imageWidth || draftCard.value.imageHeight !== project.imageHeight)) {
        draftAssetDiscovery.value = invalidateDiscoveryImage(draftAssetDiscovery.value, draftDiscoveryCardId.value)
      }
      draftCard.value = clone(project)
      if (draftDiscoveryCardId.value)
        reconcileDiscoveryOwners(draftDiscoveryCardId.value)
      return
    }
    if (!cardId || !document.value.cards.some(card => card.id === cardId))
      return
    const previous = document.value.cards.find(card => card.id === cardId)!
    const updated = updateProjectCard(document.value, cardId, project)
    const dimensionsChanged = previous.imageWidth !== project.imageWidth || previous.imageHeight !== project.imageHeight
    document.value = dimensionsChanged
      ? { ...updated, cards: updated.cards.map(card => card.id === cardId ? { ...card, ocrCandidates: undefined } : card) }
      : updated
    if (dimensionsChanged && document.value.assetDiscovery) {
      document.value = {
        ...document.value,
        assetDiscovery: invalidateDiscoveryImage(document.value.assetDiscovery, cardId),
      }
    }
    reconcileDiscoveryOwners(cardId)
  }

  /** 候補だけを更新し、通常領域の編集履歴と独立して未保存判定へ含める。 */
  function setCardOCRCandidates(cardId: string, candidates: readonly RegionCandidate[] | null) {
    const copied = candidates?.length ? cloneRegionCandidates(candidates) : undefined
    if (!document.value) {
      draftOCRCandidates.value = copied ?? []
      reconcileDiscoveryOwners(cardId)
      return
    }
    document.value = {
      ...document.value,
      cards: document.value.cards.map(card => card.id === cardId ? { ...card, ocrCandidates: copied } : card),
    }
    reconcileDiscoveryOwners(cardId)
  }

  /** フォルダプロジェクト文書を独立した複製として返す。文書がなければnullを返す。 */
  function snapshot() {
    return document.value ? clone(document.value) : null
  }

  return {
    document,
    draftCard,
    draftOCRCandidates,
    draftAssetDiscovery,
    draftDiscoveryCardId,
    assetDiscovery,
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
    setCardOCRCandidates,
    setAssetDiscovery,
    reconcileDiscoveryOwners,
    invalidateAssetDiscoveryImage,
    reconcileAssetDiscoveryContent,
    snapshot,
  }
})
