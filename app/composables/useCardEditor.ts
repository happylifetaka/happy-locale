import type { CandidateEdit, CardCandidateEditState } from '~/services/ocr/candidate-edits'
import type { CardProject, RegionDraft, TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import type { MergeOptions } from '~/utils/merge-regions'
import type { SplitAxis, SplitText } from '~/utils/split-region'
import { computed, ref } from 'vue'
import { useKeyedHistory } from '~/composables/useHistory'
import { rebaseRegionBounds } from '~/services/asset-discovery/region-comparison'
import { containsBounds, sameBounds } from '~/services/asset-discovery/review'
import { applyCandidateEdits, candidateEdits, consumedCandidateEdits } from '~/services/ocr/candidate-edits'
import { parseRegionCandidates } from '~/services/ocr/candidate-format'
import { renameCardAssetTokens } from '~/services/project/cards'
import { normalizeRegion } from '~/services/project/format/regions'
import { FILE_LIMITS } from '~/utils/file-limits'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { mergeTextRegions } from '~/utils/merge-regions'
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

export interface CardEditorCandidateBridge {
  read: (cardId: string | null) => CardCandidateEditState
  apply: (cardId: string | null, before: CardCandidateEditState, after: CardCandidateEditState) => void
}

/** 領域の編集を履歴へ確定し、変更後のカードを親の保存用ストアへ通知する。 */
export function useCardEditor(onChange?: CardEditorChangeHandler, candidates?: CardEditorCandidateBridge) {
  /** 現在の編集状態とUndo／Redoの履歴を管理する窓口。 */
  const history = useKeyedHistory<CardProject, CandidateEdit[]>(emptyProject())
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
      return []
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
    return regions.map(region => region.id)
  }

  /** 指定領域の変更を履歴へ確定し、文字列変更時の書式も調整する。 */
  function updateRegion(id: string, patch: Partial<TextRegion>, expectedCardId: string | null = activeCardId) {
    if (expectedCardId !== activeCardId)
      throw new Error('編集中のカードが変わりました。対象を選び直してください。')
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

  function changedRegionBounds(changes: readonly { id: string, bounds: RegionDraft }[]) {
    const current = history.state.value
    const byId = new Map(changes.map(change => [change.id, change.bounds]))
    const existing = new Set(current.regions.map(region => region.id))
    if (byId.size !== changes.length || changes.some(change => !existing.has(change.id)))
      throw new Error('枠を変更する領域を一つずつ選び直してください。')
    // 履歴のcommit・Storeへの通知より前に、関連データの切欠けを含む全選択を検証する。
    return current.regions.map((region) => {
      const bounds = byId.get(region.id)
      return bounds ? { ...region, ...rebaseRegionBounds(region, bounds, current.imageWidth, current.imageHeight) } : region
    })
  }

  /** 再検出の枠修正を全件検証して一つの履歴へ確定する。文字列と相対座標の意味は変えない。 */
  function applyRegionBounds(changes: readonly { id: string, bounds: RegionDraft }[]) {
    const current = history.state.value
    const regions = changedRegionBounds(changes)
    if (JSON.stringify(regions) === JSON.stringify(current.regions))
      return
    history.commit({ ...current, regions })
    publishProject()
  }

  function publishCandidateTransition(next: CardProject, edits: CandidateEdit[], direction: 'forward' | 'backward') {
    if (!candidates)
      throw new Error('OCR候補を含む編集の保存先が接続されていません。')
    const stored = candidates.read(activeCardId)
    parseRegionCandidates(stored.candidates, next.imageWidth, next.imageHeight)
    const nextCandidates = applyCandidateEdits(stored.candidates, edits, direction)
    parseRegionCandidates(nextCandidates, next.imageWidth, next.imageHeight)
    candidates.apply(activeCardId, { project: history.state.value, candidates: stored.candidates }, { project: next, candidates: nextCandidates })
  }

  /** 比較サービスで選んだ枠・候補をまとめて確定する。原文の再OCR適用とは別操作。 */
  function applyRegionDetection(
    changes: readonly { id: string, bounds: RegionDraft }[],
    beforeCandidates: readonly RegionCandidate[],
    afterCandidates: readonly RegionCandidate[],
    expectedCardId: string | null = activeCardId,
  ) {
    if (expectedCardId !== activeCardId)
      throw new Error('編集中のカードが変わりました。再比較してください。')
    if (!candidates)
      throw new Error('OCR候補を含む編集の保存先が接続されていません。')
    const current = history.state.value
    const before = parseRegionCandidates(beforeCandidates, current.imageWidth, current.imageHeight)
    parseRegionCandidates(afterCandidates, current.imageWidth, current.imageHeight)
    const stored = parseRegionCandidates(candidates.read(activeCardId).candidates, current.imageWidth, current.imageHeight)
    if (JSON.stringify(stored) !== JSON.stringify(before))
      throw new Error('比較後にOCR候補が変わりました。再比較してください。')
    const regions = changedRegionBounds(changes)
    // 保存署名を正確に戻すため、検証で正規化した値ではなく元の項目順も保つ。
    const edits = candidateEdits(beforeCandidates, afterCandidates)
    if (edits.some(edit => !edit.before && current.regions.some(region => region.id === edit.id)))
      throw new Error('新規候補のIDが既存領域と重複しています。再比較してください。')
    if (!edits.length && JSON.stringify(regions) === JSON.stringify(current.regions))
      return
    // 空の付随変更も、候補を含む検証済みの原子的な保存経路を通す目印とする。
    history.commit({ ...current, regions }, edits, (next, effect) => publishCandidateTransition(next, effect!, 'forward'))
  }

  /** 確認したアイコン位置と原文、新規領域を候補消費と同じ履歴で反映する。 */
  function applyIconAnalysis(before: CardProject, proposals: readonly TextRegion[], beforeCandidates: readonly RegionCandidate[], afterCandidates: readonly RegionCandidate[], expectedCardId: string | null) {
    const current = history.state.value
    if (expectedCardId !== activeCardId || JSON.stringify(current) !== JSON.stringify(before))
      throw new Error('解析後にカード・領域が変更されました。もう一度解析してください。')
    if (new Set(proposals.map(region => region.id)).size !== proposals.length)
      throw new Error('適用する領域が重複しています。')
    const updates = new Map<string, TextRegion>()
    const additions: TextRegion[] = []
    for (const proposed of proposals) {
      const region = structuredClone(proposed)
      if (!normalizeRegion(region, 0) || !containsBounds({ x: 0, y: 0, width: current.imageWidth, height: current.imageHeight }, region)
        || region.originalText.length > FILE_LIMITS.projectStringLength
        || new Set((region.sourceIcons ?? []).map(icon => icon.id)).size !== (region.sourceIcons ?? []).length
        || region.sourceIcons?.some(icon => !icon.assetId || !containsBounds({ x: 0, y: 0, width: region.width, height: region.height }, icon))) {
        throw new Error('反映する領域・アイコンの範囲が不正です。')
      }
      const existing = current.regions.find(item => item.id === region.id)
      if (existing) {
        if (!sameBounds(existing, region))
          throw new Error('既存領域の枠はこの操作では変更できません。')
        updates.set(region.id, { ...existing, sourceIcons: region.sourceIcons ?? [], originalText: region.originalText, translationStatus: region.originalText !== existing.originalText && existing.translationStatus === 'reviewed' ? statusForTranslation(existing.translatedText) : existing.translationStatus })
      }
      else {
        additions.push(region)
      }
    }
    if (current.regions.length + additions.length > FILE_LIMITS.projectRegionsPerCard)
      throw new Error('領域数の上限を超えます。')
    const next = { ...current, regions: [...current.regions.map(region => updates.get(region.id) ?? region), ...additions] }
    parseRegionCandidates(beforeCandidates, current.imageWidth, current.imageHeight)
    parseRegionCandidates(afterCandidates, current.imageWidth, current.imageHeight)
    const edits = consumedCandidateEdits(beforeCandidates, afterCandidates)
    if (candidates && JSON.stringify(candidates.read(activeCardId).candidates) !== JSON.stringify(beforeCandidates))
      throw new Error('解析後に領域候補が変更されました。もう一度解析してください。')
    if (!edits.length && JSON.stringify(next) === JSON.stringify(current))
      return
    if (edits.length || candidates) {
      history.commit(next, edits, (value, effect) => publishCandidateTransition(value, effect!, 'forward'))
    }
    else {
      history.commit(next)
      publishProject()
    }
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

  /** 結合を一つの履歴として確定し、基準領域のIDと一覧位置を維持する。 */
  function mergeRegions(ids: string[], options: MergeOptions) {
    const regions = ids.map(id => history.state.value.regions.find(region => region.id === id))
    if (regions.some(region => !region))
      throw new Error('結合対象の領域が見つかりません。')
    const merged = mergeTextRegions(regions as TextRegion[], options)
    history.commit({
      ...history.state.value,
      regions: history.state.value.regions.flatMap(region => region.id === options.baseId ? [merged] : ids.includes(region.id) ? [] : [region]),
    })
    selectedRegionId.value = merged.id
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
    let published = false
    history.undo((next, effect) => {
      if (effect !== null) {
        publishCandidateTransition(next, effect, 'backward')
        published = true
      }
    })
    if (!selectedRegion.value)
      selectedRegionId.value = null
    if (!published)
      publishProject()
  }

  /** 取り消した状態へ履歴を進める。 */
  function redo() {
    let published = false
    history.redo((next, effect) => {
      if (effect !== null) {
        publishCandidateTransition(next, effect, 'forward')
        published = true
      }
    })
    if (!selectedRegion.value)
      selectedRegionId.value = null
    if (!published)
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
    applyRegionBounds,
    applyRegionDetection,
    applyIconAnalysis,
    appendTemplateRegions,
    splitRegion,
    mergeRegions,
    removeRegion,
    applyTranslations,
    renameAssetToken,
    undo,
    redo,
  }
}
