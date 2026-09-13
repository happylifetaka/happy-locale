import type { CardProject, RegionDraft, TextRegion } from '~/types/editor'
import type { SplitAxis, SplitText } from '~/utils/split-region'
import { computed, ref } from 'vue'
import { useKeyedHistory } from '~/composables/useHistory'
import { renameCardAssetTokens } from '~/services/project/cards'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { splitTextRegion } from '~/utils/split-region'
import { reconcileTextStyles } from '~/utils/text-styles'
import { statusForTranslation } from '~/utils/translation-status'

/** 画像や領域がない初期カード状態を作る。 */
function emptyProject(): CardProject {
  return {
    imageName: '',
    imageWidth: 0,
    imageHeight: 0,
    regions: [],
  }
}

/** 新しい領域等を識別する一意なIDを生成する。 */
function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `region-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export type CardEditorChangeHandler = (
  cardId: string | null,
  project: CardProject,
) => void

/** 領域の編集を履歴へ確定し、変更後のカードを親の保存用ストアへ通知する。 */
export function useCardEditor(onChange?: CardEditorChangeHandler) {
  /** 現在の編集状態とUndo／Redoの履歴を管理する窓口。 */
  const history = useKeyedHistory(emptyProject())
  /** カードで現在選択している領域ID。 */
  const selectedRegionId = ref<string | null>(null)
  /** 現在の編集内容を親へ通知するときに対応付けるカードID。 */
  let activeCardId: string | null = null

  /** 現在のカードとIDを変更通知先へ渡す。 */
  function publishProject() {
    onChange?.(activeCardId, history.state.value)
  }

  /** 現在の履歴状態から選択IDに対応する領域を取得した値。 */
  const selectedRegion = computed(
    () =>
      history.state.value.regions.find(
        region => region.id === selectedRegionId.value,
      ) ?? null,
  )

  /** 新規画像の寸法で編集状態と履歴を初期化する。 */
  function loadImageProject(imageName: string, width: number, height: number) {
    activeCardId = null
    history.reset(null, {
      imageName,
      imageWidth: width,
      imageHeight: height,
      regions: [],
    })
    selectedRegionId.value = null
    publishProject()
  }

  /** 保存済みカードを読み込み、プロジェクトの編集履歴を初期化する。 */
  function loadSavedProject(project: CardProject, cardId?: string) {
    activeCardId = cardId ?? null
    history.reset(activeCardId, project)
    selectedRegionId.value = null
    publishProject()
  }

  /** 対象カードの状態へ切り替え、対応する履歴を復元する。 */
  function switchSavedProject(cardId: string, project: CardProject) {
    activeCardId = cardId
    history.switchTo(cardId, project)
    selectedRegionId.value = null
    publishProject()
  }

  /** 初回保存後のカードIDを現在の履歴へ関連付ける。 */
  function bindSavedCard(cardId: string) {
    activeCardId = cardId
    history.bindKey(cardId)
    publishProject()
  }

  /** 現在のカード画像名を更新し、変更を親へ通知する。 */
  function renameImage(imageName: string) {
    history.state.value = { ...history.state.value, imageName }
    publishProject()
  }

  /** 指定範囲に新しい翻訳領域を追加する。 */
  function addRegion(bounds: RegionDraft, backgroundColor: string) {
    const sequence = history.state.value.regions.length + 1
    const region: TextRegion = {
      id: createId(),
      regionId: `region_${sequence}`,
      displayName: `領域 ${sequence}`,
      ...bounds,
      originalText: '',
      translatedText: '',
      translationStatus: 'untranslated',
      textStyles: [],
      inlineAssetStyles: [],
      backgroundMode: 'auto',
      autoMaskPreset: 'auto',
      autoMaskSensitivity: 60,
      removeColorOutliers: true,
      backgroundColor,
      manualMaskStrokes: [],
      exclusionAreas: [],
      textColor: '#ffffff',
      textStrokeColor: '#111111',
      textStrokeWidth: 2,
      fontSize: Math.max(12, Math.min(28, Math.round(bounds.height * 0.3))),
      autoFitFontSize: true,
      fontId: null,
      textAlign: 'left',
      verticalAlign: 'middle',
    }
    history.commit({
      ...history.state.value,
      regions: [...history.state.value.regions, region],
    })
    selectedRegionId.value = region.id
    publishProject()
  }

  /** 複数の認識候補をまとめて編集領域へ追加する。 */
  function addRegions(
    drafts: Array<{
      bounds: RegionDraft
      backgroundColor: string
      originalText: string
    }>,
  ) {
    if (drafts.length === 0)
      return
    const firstSequence = history.state.value.regions.length + 1
    const regions = drafts.map((draft, index): TextRegion => {
      const sequence = firstSequence + index
      return {
        id: createId(),
        regionId: `region_${sequence}`,
        displayName: `領域 ${sequence}`,
        ...draft.bounds,
        originalText: draft.originalText,
        translatedText: '',
        translationStatus: 'untranslated',
        textStyles: [],
        inlineAssetStyles: [],
        backgroundMode: 'auto',
        autoMaskPreset: 'auto',
        autoMaskSensitivity: 60,
        removeColorOutliers: true,
        backgroundColor: draft.backgroundColor,
        manualMaskStrokes: [],
        exclusionAreas: [],
        textColor: '#ffffff',
        textStrokeColor: '#111111',
        textStrokeWidth: 2,
        fontSize: Math.max(
          12,
          Math.min(28, Math.round(draft.bounds.height * 0.3)),
        ),
        autoFitFontSize: true,
        fontId: null,
        textAlign: 'left',
        verticalAlign: 'middle',
      }
    })
    history.commit({
      ...history.state.value,
      regions: [...history.state.value.regions, ...regions],
    })
    selectedRegionId.value = regions.at(-1)?.id ?? null
    publishProject()
  }

  /** 指定領域の変更を履歴へ確定し、文字列変更時の書式も調整する。 */
  function updateRegion(id: string, patch: Partial<TextRegion>) {
    history.commit({
      ...history.state.value,
      regions: history.state.value.regions.map(region =>
        region.id === id
          ? {
              ...region,
              ...patch,
              ...(patch.translatedText !== undefined
                && patch.textStyles === undefined
                && patch.translatedText !== region.translatedText
                ? {
                    textStyles: reconcileTextStyles(
                      region.translatedText,
                      patch.translatedText,
                      region.textStyles,
                    ),
                  }
                : {}),
              ...(patch.translatedText !== undefined
                && patch.inlineAssetStyles === undefined
                && patch.translatedText !== region.translatedText
                ? {
                    inlineAssetStyles: reconcileInlineAssetStyles(
                      region.translatedText,
                      patch.translatedText,
                      region.inlineAssetStyles,
                    ),
                  }
                : {}),
              ...(patch.translatedText !== undefined
                && patch.translationStatus === undefined
                && patch.translatedText !== region.translatedText
                ? {
                    translationStatus: statusForTranslation(
                      patch.translatedText,
                    ),
                  }
                : {}),
              ...(patch.originalText !== undefined
                && patch.translationStatus === undefined
                && patch.originalText !== region.originalText
                && region.translationStatus === 'reviewed'
                ? {
                    translationStatus: statusForTranslation(
                      region.translatedText,
                    ),
                  }
                : {}),
              id,
            }
          : region,
      ),
    })
    publishProject()
  }

  /** 雛形の領域へ新しいIDを与えて現在のカードに追加する。 */
  function appendTemplateRegions(regions: readonly TextRegion[]) {
    if (!regions.length)
      return
    const added = regions.map((region) => {
      const id = createId()
      return { ...region, id, regionId: `region_${id}` }
    })
    history.commit({
      ...history.state.value,
      regions: [...history.state.value.regions, ...added],
    })
    selectedRegionId.value = added[0]!.id
    publishProject()
  }

  /** 一つの領域を指定した二領域へ置き換える。 */
  function splitRegion(id: string, axis: SplitAxis, position: number, texts: readonly [SplitText, SplitText]) {
    const region = history.state.value.regions.find(item => item.id === id)
    if (!region)
      return
    const [first, second] = splitTextRegion(region, axis, position, texts)
    const newId = createId()
    second.id = newId
    second.regionId = `region_${newId}`
    history.commit({
      ...history.state.value,
      regions: history.state.value.regions.flatMap(item => item.id === id ? [first, second] : [item]),
    })
    selectedRegionId.value = id
    publishProject()
  }

  /** 指定領域を履歴に記録して削除する。 */
  function removeRegion(id: string) {
    history.commit({
      ...history.state.value,
      regions: history.state.value.regions.filter(region => region.id !== id),
    })
    if (selectedRegionId.value === id)
      selectedRegionId.value = null
    publishProject()
  }

  /** 対応する領域の訳文をまとめて反映する。 */
  function applyTranslations(translations: Map<string, string>) {
    const regions = history.state.value.regions.map((region) => {
      const translation = translations.get(region.regionId)
      return translation === undefined
        ? region
        : {
            ...region,
            translatedText: translation,
            translationStatus: statusForTranslation(translation),
            textStyles: reconcileTextStyles(
              region.translatedText,
              translation,
              region.textStyles,
            ),
            inlineAssetStyles: reconcileInlineAssetStyles(
              region.translatedText,
              translation,
              region.inlineAssetStyles,
            ),
          }
    })
    if (
      regions.some(
        (region, index) => region !== history.state.value.regions[index],
      )
    ) {
      history.commit({ ...history.state.value, regions })
      publishProject()
    }
  }

  /** アセット名はカード共通なので、現在値だけでなく過去・未来の履歴内の参照も移行する。 */
  function renameAssetToken(
    assetId: string,
    previousName: string,
    nextName: string,
  ) {
    history.mapStates(project => renameCardAssetTokens(
      project,
      assetId,
      previousName,
      nextName,
    ))
    publishProject()
  }

  /** 直前の確定状態へ履歴を戻す。 */
  function undo() {
    history.undo()
    if (!selectedRegion.value)
      selectedRegionId.value = null
    publishProject()
  }

  /** 取り消した状態へ履歴を進める。 */
  function redo() {
    history.redo()
    if (!selectedRegion.value)
      selectedRegionId.value = null
    publishProject()
  }

  return {
    project: history.state,
    selectedRegionId,
    selectedRegion,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    loadImageProject,
    loadSavedProject,
    switchSavedProject,
    bindSavedCard,
    renameImage,
    addRegion,
    addRegions,
    updateRegion,
    appendTemplateRegions,
    splitRegion,
    removeRegion,
    applyTranslations,
    renameAssetToken,
    undo,
    redo,
  }
}
