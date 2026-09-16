<script setup lang="ts">
import type { OCRCorrectionChange } from '~/services/ocr/correction-types'
import type { OCRLayout } from '~/services/ocr/types'
import type {
  AutoMaskPreset,
  BackgroundMode,
  FontReference,
  GlossaryEntry,
  ImageAsset,
  InlineAssetStyleRange,
  OCRDictionaryEntry,
  TextAlign,
  TextRegion,
  VerticalAlign,
} from '~/types/editor'
import { storeToRefs } from 'pinia'
import { pickScreenColor, supportsEyeDropper } from '~/services/colors/eye-dropper'
import { useEditorToolsStore } from '~/stores/editor-tools'
import { findUnresolvedAssetNames } from '~/utils/assets'
import { findGlossaryMatches } from '~/utils/glossary'
import {
  findInlineAssetOccurrences,
  inlineAssetStyleForOccurrence,
  updateInlineAssetStyle,
} from '~/utils/inline-assets'
import { regionTextLayout } from '~/utils/region-text-layout'
import { rubyDisplayRegion, rubyFontSize } from '~/utils/ruby'
import { applyTextStyle, reconcileTextStyles } from '~/utils/text-styles'
import { translationConsistencyWarnings } from '~/utils/translation-reuse'

const props = defineProps<{
  region: TextRegion | null
  activeTab: 'region' | 'ocr' | 'text'
  autoMaskPreview: boolean
  selectedExclusionId: string | null
  fonts: FontReference[]
  loadedFontIds: Set<string>
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  ocrRunning: boolean
  ocrProgress: number | null
  ocrStatus: string
  ocrCandidate: string
  ocrConfidence: number | null
  ocrLayout: OCRLayout
  ocrFillEnabled: boolean
  ocrCorrectionCandidate: string
  ocrCorrectionChanges: OCRCorrectionChange[]
  ocrDictionary: OCRDictionaryEntry[]
  translationEnabled: boolean
  translationRunning: boolean
  glossary: GlossaryEntry[]
  reusableTranslationCount: number
}>()
const emit = defineEmits<{
  update: [id: string, patch: Partial<TextRegion>]
  deferPreview: [composing: boolean]
  flushPreview: []
  updateAutoMaskPreview: [enabled: boolean]
  toggleMaskEditing: []
  clearMask: [id: string]
  toggleExclusionEditing: []
  selectExclusion: [id: string]
  removeExclusion: [regionId: string, exclusionId: string]
  recognizeText: []
  updateOcrCandidate: [text: string]
  updateOcrCorrectionCandidate: [text: string]
  applyOcrCandidate: []
  discardOcrCandidate: []
  applyOcrCorrection: []
  discardOcrCorrection: []
  addOcrDictionaryEntry: [source: string, replacement: string]
  removeOcrDictionaryEntry: [id: string]
  updateOcrLayout: [layout: OCRLayout]
  updateOcrFillEnabled: [enabled: boolean]
  translate: []
  split: []
  sourceIcons: []
  reuseTranslation: []
}>()
const editorTools = useEditorToolsStore()
const { maskEditing, maskBrushSize, maskBrushMode, exclusionEditing } = storeToRefs(editorTools)

/** 訳文の選択範囲とカーソルを操作する入力欄。 */
const translationInput = ref<HTMLTextAreaElement | null>(null)
/** 原文へのアセット挿入位置を取得する入力欄。 */
const originalInput = ref<HTMLTextAreaElement | null>(null)
/** 原文で参照している未登録のアセット名。 */
const unresolvedOriginalAssets = computed(() => findUnresolvedAssetNames(props.region?.originalText ?? '', props.assets))
/** 原文と訳文の数値・アイコンを機械的に比較した確認事項。 */
const consistencyWarnings = computed(() => translationConsistencyWarnings(props.region?.originalText ?? '', props.region?.translatedText ?? '', props.assets))
/** OCR補正辞書へ登録する誤認識文字列。 */
const dictionarySource = ref('')
/** OCR補正辞書に登録する置換後の文字列。 */
const dictionaryReplacement = ref('')
/** 訳文入力欄の選択範囲。UTF-16の半開区間。 */
const textSelection = ref({ start: 0, end: 0 })
/** 選択文字に適用する色の入力値。 */
const partialTextColor = ref('#ef4444')
/** 選択文字に適用するフォントIDの入力値。 */
const partialFontId = ref('')
/** ブラウザが画面上の色採取に対応しているか。 */
const eyeDropperSupported = ref(false)
/** スポイト操作に失敗した理由。 */
const eyeDropperError = ref('')
/** 訳文に残っている未登録のアセット名。 */
const unresolvedAssetNames = computed(() => findUnresolvedAssetNames(
  props.region?.translatedText ?? '',
  props.assets,
))
/** 原文に含まれる用語集の候補。 */
const glossaryMatches = computed(() => findGlossaryMatches(
  props.region?.originalText ?? '',
  props.glossary,
))
/** 訳文中の登録済みアセットと各出現位置。 */
const inlineAssetOccurrences = computed(() => findInlineAssetOccurrences(
  props.region?.translatedText ?? '',
  props.assets,
))
/** 現在の文字選択に対応するインラインアセットの出現箇所。 */
const selectedInlineAsset = computed(() => {
  const start = textSelection.value.start
  const end = textSelection.value.end
  return inlineAssetOccurrences.value.find(occurrence =>
    start === end
      ? start >= occurrence.start && start < occurrence.end
      : start <= occurrence.start && end >= occurrence.end,
  ) ?? null
})
/** 選択した出現箇所が参照する共有アセット定義。 */
const selectedInlineAssetDefinition = computed(() =>
  props.assets.find(asset => asset.id === selectedInlineAsset.value?.assetId)
  ?? null,
)
/** 選択した出現箇所だけに適用されている配置設定。 */
const selectedInlineAssetStyle = computed(() => {
  if (!props.region || !selectedInlineAsset.value)
    return undefined
  return inlineAssetStyleForOccurrence(
    props.region.inlineAssetStyles ?? [],
    selectedInlineAsset.value,
  )
})

// ブラウザでスポイト機能が使用可能か確認する。
onMounted(() => {
  eyeDropperSupported.value = supportsEyeDropper()
})

// 別の領域の本文へ部分書式を誤適用しないよう選択範囲をリセットする。
watch(
  () => props.region?.id,
  () => {
    textSelection.value = { start: 0, end: 0 }
  },
)

/** 入力した誤認識文字列と置換先をOCR辞書へ登録するよう通知する。 */
function addDictionaryEntry() {
  if (!dictionarySource.value.trim() || !dictionaryReplacement.value.trim())
    return
  emit(
    'addOcrDictionaryEntry',
    dictionarySource.value,
    dictionaryReplacement.value,
  )
  dictionarySource.value = ''
  dictionaryReplacement.value = ''
}

/** 入力された設定項目の変更を親へ通知する。 */
function update(field: keyof TextRegion, event: Event) {
  if (!props.region)
    return
  const element = event.target as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const numericFields: (keyof TextRegion)[] = [
    'fontSize',
    'rubyFontSize',
    'rubyGap',
    'textStrokeWidth',
    'autoMaskSensitivity',
  ]
  const value = numericFields.includes(field)
    ? Number(element.value)
    : element.value
  emit('update', props.region.id, { [field]: value })
}

/** 訳文の横揃えの変更を親へ通知する。 */
function updateAlign(event: Event) {
  if (!props.region)
    return
  const value = (event.target as HTMLSelectElement).value as TextAlign
  emit('update', props.region.id, { textAlign: value })
}

/** 訳文の縦揃えの変更を親へ通知する。 */
function updateVerticalAlign(event: Event) {
  if (!props.region)
    return
  const value = (event.target as HTMLSelectElement).value as VerticalAlign
  emit('update', props.region.id, { verticalAlign: value })
}

/** 原文を隠す背景処理方式の変更を通知する。 */
function updateBackgroundMode(event: Event) {
  if (!props.region)
    return
  const value = (event.target as HTMLSelectElement).value as BackgroundMode
  emit('update', props.region.id, { backgroundMode: value })
}

/** 自動マスクの文字色判定プリセットを変更する。 */
function updateAutoMaskPreset(event: Event) {
  if (!props.region)
    return
  const value = (event.target as HTMLSelectElement).value as AutoMaskPreset
  emit('update', props.region.id, { autoMaskPreset: value })
}

/** 領域全体に使用するフォントの変更を通知する。 */
function updateFont(event: Event) {
  if (!props.region)
    return
  const value = (event.target as HTMLSelectElement).value
  emit('update', props.region.id, { fontId: value || null })
}

/** 訳文入力欄の選択位置を部分書式の操作用に保持する。 */
function captureTextSelection() {
  const element = translationInput.value
  if (!element)
    return
  textSelection.value = {
    start: element.selectionStart,
    end: element.selectionEnd,
  }
}

/** 入力内容を即時反映しつつ、IME中の描画を遅延させ、変更していない文字の書式を保持する。 */
function updateTranslation(event: Event) {
  emit('deferPreview', (event as InputEvent).isComposing === true)
  if (!props.region)
    return
  const translatedText = (event.target as HTMLTextAreaElement).value
  emit('update', props.region.id, {
    translatedText,
    textStyles: reconcileTextStyles(
      props.region.translatedText,
      translatedText,
      props.region.textStyles,
    ),
  })
}

/** 原文の選択範囲へアセットトークンを挿入する。 */
function insertOriginalAsset(asset: ImageAsset) {
  const input = originalInput.value
  if (!props.region || !input)
    return
  const start = input.selectionStart
  const token = `[icon:${asset.name}]`
  emit('update', props.region.id, { originalText: input.value.slice(0, start) + token + input.value.slice(input.selectionEnd) })
  nextTick(() => {
    input.focus()
    input.setSelectionRange(start + token.length, start + token.length)
  })
}

/** 採取色を領域全体へ適用するか、選択文字に適用する色の入力値として保持する。 */
async function pickTextColor(partial: boolean) {
  if (!props.region)
    return
  eyeDropperError.value = ''
  try {
    const color = await pickScreenColor()
    if (!color)
      return
    if (partial)
      partialTextColor.value = color
    else
      emit('update', props.region.id, { textColor: color })
  }
  catch (error) {
    eyeDropperError.value
      = error instanceof Error ? error.message : '画像から色を取得できませんでした。'
  }
}

/** 選択した文字範囲へ書式を適用する。領域全体のフォント・色とは別の上書きとして扱う。 */
function applySelectionStyle(
  patch: { textColor?: string, fontId?: string | null } | null,
) {
  if (!props.region || textSelection.value.start === textSelection.value.end)
    return
  emit('update', props.region.id, {
    textStyles: applyTextStyle(
      props.region.textStyles,
      props.region.translatedText.length,
      textSelection.value.start,
      textSelection.value.end,
      patch,
    ),
  })
  nextTick(() => {
    translationInput.value?.focus()
    translationInput.value?.setSelectionRange(
      textSelection.value.start,
      textSelection.value.end,
    )
  })
}

/** チェック状態を設定値へ変換して親へ通知する。 */
function updateBoolean(field: keyof TextRegion, event: Event) {
  if (!props.region)
    return
  emit('update', props.region.id, {
    [field]: (event.target as HTMLInputElement).checked,
  })
}

/** 選択文字をアイコントークンへ置き換え、挿入位置の後ろへカーソルを戻す。 */
function insertAsset(asset: ImageAsset) {
  if (!props.region)
    return
  const element = translationInput.value
  const start = element?.selectionStart ?? props.region.translatedText.length
  const end = element?.selectionEnd ?? start
  const token = `[icon:${asset.name}]`
  const translatedText
    = props.region.translatedText.slice(0, start)
      + token
      + props.region.translatedText.slice(end)
  emit('update', props.region.id, { translatedText })
  nextTick(() => {
    element?.focus()
    const cursor = start + token.length
    element?.setSelectionRange(cursor, cursor)
    textSelection.value = { start: cursor, end: cursor }
  })
}

/** 用語集の訳語を現在の訳文へ挿入する。 */
function insertGlossaryTranslation(entry: GlossaryEntry) {
  if (!props.region)
    return
  const element = translationInput.value
  const start = element?.selectionStart ?? props.region.translatedText.length
  const end = element?.selectionEnd ?? start
  const translatedText
    = props.region.translatedText.slice(0, start)
      + entry.translation
      + props.region.translatedText.slice(end)
  emit('update', props.region.id, {
    translatedText,
    textStyles: reconcileTextStyles(
      props.region.translatedText,
      translatedText,
      props.region.textStyles,
    ),
  })
  nextTick(() => {
    const cursor = start + entry.translation.length
    element?.focus()
    element?.setSelectionRange(cursor, cursor)
    textSelection.value = { start: cursor, end: cursor }
  })
}

/** 指定したアセットトークンを訳文入力欄で選択する。 */
function selectInlineAssetOccurrence(start: number, end: number) {
  textSelection.value = { start, end }
  nextTick(() => {
    translationInput.value?.focus()
    translationInput.value?.setSelectionRange(start, end)
  })
}

/** 同じアセットが複数あっても、選択した出現箇所だけの大きさ・位置・余白を変更する。 */
function updateSelectedInlineAssetStyle(
  field: 'scale' | 'baselineOffset' | 'inlinePadding',
  event: Event,
) {
  const region = props.region
  const occurrence = selectedInlineAsset.value
  if (!region || !occurrence)
    return
  const current = selectedInlineAssetStyle.value
  const patch: Pick<
    InlineAssetStyleRange,
    'scale' | 'baselineOffset' | 'inlinePadding'
  > = {
    ...(current?.scale !== undefined ? { scale: current.scale } : {}),
    ...(current?.baselineOffset !== undefined
      ? { baselineOffset: current.baselineOffset }
      : {}),
    ...(current?.inlinePadding !== undefined
      ? { inlinePadding: current.inlinePadding }
      : {}),
    [field]: Number((event.target as HTMLInputElement).value),
  }
  emit('update', region.id, {
    inlineAssetStyles: updateInlineAssetStyle(
      region.inlineAssetStyles ?? [],
      occurrence,
      patch,
    ),
  })
}

/** 選択したアイコン出現箇所の個別設定を解除する。 */
function resetSelectedInlineAssetStyle() {
  const region = props.region
  const occurrence = selectedInlineAsset.value
  if (!region || !occurrence)
    return
  emit('update', region.id, {
    inlineAssetStyles: updateInlineAssetStyle(
      region.inlineAssetStyles ?? [],
      occurrence,
      null,
    ),
  })
}
</script>

<template>
  <section class="inspector">
    <p v-if="!region" class="muted">
      画像上をドラッグして領域を追加するか、「一覧」から既存領域を選択してください。
    </p>
    <form v-else :key="region.id" @submit.prevent>
      <button type="button" @click="emit('split')">
        この領域を分割…
      </button>
      <button type="button" :disabled="ocrRunning" @click="emit('sourceIcons')">
        元画像のアイコンを指定（{{ region.sourceIcons?.length ?? 0 }}）
      </button>
      <div
        v-show="activeTab === 'ocr'"
        id="inspector-panel-ocr"
        class="ocr-controls inspector-tab-panel"
        role="tabpanel"
        aria-labelledby="inspector-tab-ocr"
      >
        <strong>英語OCR</strong>
        <label class="checkbox-field">
          <span>
            <input
              type="checkbox"
              :checked="ocrFillEnabled"
              @change="
                $emit(
                  'updateOcrFillEnabled',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            >
            塗りつぶしを有効にする
          </span>
          <small>
            無効化は表示上だけです。OCR候補の反映・破棄後は有効に戻ります。
          </small>
        </label>
        <label>
          文字レイアウト
          <select
            :value="ocrLayout"
            :disabled="ocrRunning"
            @change="
              $emit(
                'updateOcrLayout',
                ($event.target as HTMLSelectElement).value as OCRLayout,
              )
            "
          >
            <option value="text-block">複数行の文章</option>
            <option value="single-line">1行の文章</option>
          </select>
        </label>
        <button
          type="button"
          :disabled="ocrRunning"
          @click="$emit('recognizeText')"
        >
          {{ ocrRunning ? '認識しています…' : '選択領域を認識' }}
        </button>
        <progress
          v-if="ocrRunning && ocrProgress !== null"
          :value="ocrProgress"
          max="1"
        />
        <small v-if="ocrRunning">{{ ocrStatus }}</small>
        <template v-if="ocrCandidate">
          <label>
            1. OCR読み取り結果
            <textarea
              rows="4"
              :value="ocrCandidate"
              @input="
                $emit(
                  'updateOcrCandidate',
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </label>
          <small v-if="ocrConfidence !== null">
            認識信頼度: {{ Math.round(ocrConfidence) }}%
          </small>
          <div v-if="ocrCorrectionCandidate" class="ocr-correction">
            <strong>2. 自動補正で変わる箇所</strong>
            <ul class="ocr-correction-list">
              <li
                v-for="(change, index) in ocrCorrectionChanges"
                :key="`${change.line}-${change.original}-${index}`"
              >
                <span class="ocr-correction-line">{{ change.line }}行目</span>
                <del>{{ change.original }}</del>
                <span aria-hidden="true">→</span>
                <ins>{{ change.corrected }}</ins>
              </li>
            </ul>
            <label>
              3. 補正後の結果（採用前に編集できます）
              <textarea
                rows="4"
                :value="ocrCorrectionCandidate"
                @input="
                  $emit(
                    'updateOcrCorrectionCandidate',
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </label>
            <small>
              {{ ocrCorrectionChanges.length }}箇所が変わります。内容を確認し、問題なければOCR結果へ反映してください。
            </small>
            <div class="ocr-actions">
              <button
                type="button"
                class="primary"
                @click="$emit('applyOcrCorrection')"
              >
                この補正結果を採用
              </button>
              <button type="button" @click="$emit('discardOcrCorrection')">
                元のOCR結果を使う
              </button>
            </div>
          </div>
          <div class="ocr-actions">
            <button
              type="button"
              class="primary"
              @click="$emit('applyOcrCandidate')"
            >
              現在のOCR結果を元テキストへ反映
            </button>
            <button type="button" @click="$emit('discardOcrCandidate')">
              破棄
            </button>
          </div>
        </template>
        <details class="ocr-dictionary">
          <summary>ユーザー辞書（{{ ocrDictionary.length }}件）</summary>
          <p class="muted">
            OCRの誤認識と正しい文字を登録します。大文字・小文字は区別しません。
          </p>
          <div class="ocr-dictionary-fields">
            <label>
              誤認識
              <input v-model="dictionarySource" type="text" placeholder="Wounb">
            </label>
            <label>
              正しい文字
              <input v-model="dictionaryReplacement" type="text" placeholder="Wound">
            </label>
          </div>
          <button
            type="button"
            :disabled="!dictionarySource.trim() || !dictionaryReplacement.trim()"
            @click="addDictionaryEntry"
          >
            辞書へ追加
          </button>
          <ul v-if="ocrDictionary.length" class="ocr-dictionary-list">
            <li v-for="entry in ocrDictionary" :key="entry.id">
              <span><code>{{ entry.source }}</code> → {{ entry.replacement }}</span>
              <button
                type="button"
                @click="$emit('removeOcrDictionaryEntry', entry.id)"
              >
                削除
              </button>
            </li>
          </ul>
        </details>
        <small>OCR開始時に元画像表示へ切り替わります。</small>
      </div>
      <div
        v-show="activeTab === 'region'"
        id="inspector-panel-region"
        class="inspector-tab-panel"
        role="tabpanel"
        aria-labelledby="inspector-tab-region"
      >
        <label>
          背景処理
          <select :value="region.ruby ? 'none' : region.backgroundMode" :disabled="region.ruby" @change="updateBackgroundMode">
            <option value="auto">文字のみ自動補修</option>
            <option value="manual">手動マスク補修</option>
            <option value="solid">単色塗りつぶし</option>
            <option value="none">塗りつぶさない（文字のみ）</option>
          </select>
        </label>
        <p v-if="region.backgroundMode === 'none'" class="muted">
          元画像を変更せず、日本語訳とインラインアセットだけを描画します。
        </p>
        <label v-if="region.backgroundMode === 'auto'">
          検出プリセット
          <select :value="region.autoMaskPreset" @change="updateAutoMaskPreset">
            <option value="auto">自動判定</option>
            <option value="light">白文字・明るい文字</option>
            <option value="dark">黒文字・暗い文字</option>
          </select>
          <small>背景模様を誤検出する場合は文字の明るさを指定してください。</small>
        </label>
        <label v-if="region.backgroundMode === 'auto'">
          文字の検出強度（{{ region.autoMaskSensitivity }}）
          <input
            type="range"
            min="0"
            max="100"
            :value="region.autoMaskSensitivity"
            @change="update('autoMaskSensitivity', $event)"
          >
          <small>黒文字や影が残る場合は強くしてください。</small>
        </label>
        <label v-if="region.backgroundMode === 'auto'" class="checkbox-field">
          <span>
            <input
              type="checkbox"
              :checked="region.removeColorOutliers"
              @change="updateBoolean('removeColorOutliers', $event)"
            >
            色の外れ値を除去
          </span>
          <small>背景の多数派色と異なる赤・青・白なども補修します。</small>
        </label>
        <label v-if="region.backgroundMode === 'auto'" class="checkbox-field">
          <span>
            <input
              type="checkbox"
              :checked="autoMaskPreview"
              @change="
                $emit(
                  'updateAutoMaskPreview',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            >
            補修範囲を表示
          </span>
          <small>元画像上で、自動検出された補修範囲を赤く表示します。</small>
        </label>
        <div v-if="region.backgroundMode === 'manual'" class="mask-controls">
          <button
            type="button"
            :class="{ primary: maskEditing }"
            @click="$emit('toggleMaskEditing')"
          >
            {{ maskEditing ? 'マスク編集を終了' : 'マスクをブラシで編集' }}
          </button>
          <label>
            ブラシ
            <select
              v-model="maskBrushMode"
            >
              <option value="paint">補修範囲を追加</option>
              <option value="erase">消しゴム</option>
            </select>
          </label>
          <label>
            ブラシサイズ
            <input
              v-model.number="maskBrushSize"
              type="range"
              min="4"
              max="80"
            >
          </label>
          <button type="button" @click="$emit('clearMask', region.id)">
            マスクを消去
          </button>
          <p class="muted">
            赤く塗った場所だけが背景で補修されます。各ブラシ操作は上部のUndo / Redoで1ストロークずつ戻せます。
          </p>
        </div>
        <div class="exclusion-controls">
          <strong>保護領域</strong>
          <button
            type="button"
            :class="{ primary: exclusionEditing }"
            @click="$emit('toggleExclusionEditing')"
          >
            {{ exclusionEditing ? '画像上をドラッグ' : '保護領域を追加' }}
          </button>
          <p class="muted">
            元画像を残したいアイコン等を囲みます。ドラッグ選択後は自動で追加を終了し、移動や四隅でのサイズ変更ができます。
          </p>
          <div
            v-for="(area, index) in region.exclusionAreas"
            :key="area.id"
            class="exclusion-item"
          >
            <button
              type="button"
              :class="{ selected: area.id === selectedExclusionId }"
              @click="$emit('selectExclusion', area.id)"
            >
              保護領域 {{ index + 1 }}
            </button>
            <button
              type="button"
              aria-label="保護領域を削除"
              @click="$emit('removeExclusion', region.id, area.id)"
            >
              削除
            </button>
          </div>
        </div>
        <label>
          表示名
          <input
            :value="region.displayName"
            placeholder="例: 戦闘時の効果"
            @change="update('displayName', $event)"
          >
          <small>領域一覧に表示する名前です。日本語を使用できます。</small>
        </label>
        <label>
          CSV ID（region_id）
          <input :value="region.regionId" @change="update('regionId', $event)">
          <small>CSV照合用の安定したキーです。例: effect_1</small>
        </label>
      </div>
      <div
        v-show="activeTab === 'text'"
        id="inspector-panel-text"
        class="inspector-tab-panel"
        role="tabpanel"
        aria-labelledby="inspector-tab-text"
      >
        <label>
          翻訳ステータス
          <select
            :value="region.translationStatus"
            @change="update('translationStatus', $event)"
          >
            <option value="untranslated">未翻訳</option>
            <option value="draft">下書き</option>
            <option value="reviewed" :disabled="!region.translatedText.trim()">
              確認済み
            </option>
          </select>
        </label>
        <label class="checkbox-field">
          <span><input type="checkbox" aria-label="ルビとして原文の上に表示" :checked="region.ruby === true" @change="updateBoolean('ruby', $event)">ルビとして原文の上に表示</span>
          <small>OCR領域は原文の位置に保持し、日本語訳だけを上に配置します。背景は塗りつぶしません。</small>
        </label>
        <template v-if="region.ruby">
          <label>ルビと領域上端の間隔 (px)<input type="number" min="-200" max="200" :value="region.rubyGap ?? 0" @change="update('rubyGap', $event)"></label>
          <p class="muted">
            1行の短い訳向けです。上に別の文字や絵がある場合はプレビューで確認してください。長いOCR領域は先に分割してください。
          </p>
          <p v-if="rubyDisplayRegion(region).height < rubyFontSize(region) * 1.25" role="status">
            画像上端までの余白が少ないため、ルビが縮小または切れる場合があります。
          </p>
        </template>
        <div class="translation-field">
          <div class="text-field-heading">
            <label for="original-text">元テキスト</label>
            <AssetInsertPicker :key="`${region.id}-${activeTab}-original`" :assets="assets" :asset-images="assetImages" target-label="元テキスト" @insert="insertOriginalAsset" />
          </div>
          <textarea
            id="original-text"
            ref="originalInput"
            rows="4"
            :value="region.originalText"
            @change="update('originalText', $event)"
          />
        </div>
        <p v-if="unresolvedOriginalAssets.length" class="field-error" role="status">
          原文の未登録アセット: {{ unresolvedOriginalAssets.join('、') }}
        </p>
        <div class="translation-actions">
          <button
            v-if="translationEnabled"
            type="button"
            :disabled="translationRunning || !region.originalText.trim()"
            @click="$emit('translate')"
          >
            {{ translationRunning ? '翻訳しています…' : '翻訳候補を取得' }}
          </button>
          <button type="button" :disabled="!reusableTranslationCount" @click="emit('reuseTranslation')">
            既存訳を再利用（{{ reusableTranslationCount }}件）
          </button>
        </div>
        <div class="translation-field">
          <div class="text-field-heading">
            <label for="translated-text">日本語訳</label>
            <AssetInsertPicker :key="`${region.id}-${activeTab}-translated`" :assets="assets" :asset-images="assetImages" target-label="日本語訳" @insert="insertAsset" />
          </div>
          <textarea
            id="translated-text"
            ref="translationInput"
            rows="5"
            :value="region.translatedText"
            @input="updateTranslation"
            @compositionstart="emit('deferPreview', true)"
            @compositionend="emit('deferPreview', false)"
            @blur="emit('flushPreview')"
            @click="captureTextSelection"
            @select="captureTextSelection"
            @keyup="captureTextSelection"
            @mouseup="captureTextSelection"
          />
          <small
            v-if="unresolvedAssetNames.length > 0"
            class="field-error"
            role="status"
          >
            未登録のアセット: {{ unresolvedAssetNames.join('、') }}。トークンは文字列のまま表示されます。
          </small>
          <ul v-if="consistencyWarnings.length" class="consistency-warnings" role="status">
            <li v-for="warning in consistencyWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
          <section v-if="glossaryMatches.length" class="glossary-matches">
            <strong>用語集の候補</strong>
            <ul>
              <li v-for="entry in glossaryMatches" :key="entry.id">
                <span><code>{{ entry.source }}</code> → {{ entry.translation }}</span>
                <button type="button" @click="insertGlossaryTranslation(entry)">
                  訳語を挿入
                </button>
              </li>
            </ul>
          </section>
          <section v-if="inlineAssetOccurrences.length" class="inline-asset-editor">
            <div class="inline-asset-occurrences">
              <strong>訳文内で使用中</strong>
              <span>
                <button
                  v-for="occurrence in inlineAssetOccurrences"
                  :key="`${occurrence.start}-${occurrence.assetId}`"
                  type="button"
                  :class="{
                    selected:
                      selectedInlineAsset?.start === occurrence.start
                      && selectedInlineAsset?.end === occurrence.end,
                  }"
                  @click="selectInlineAssetOccurrence(occurrence.start, occurrence.end)"
                >
                  {{ occurrence.assetName }} {{ occurrence.occurrence + 1 }}
                </button>
              </span>
            </div>
            <fieldset
              v-if="selectedInlineAsset && selectedInlineAssetDefinition"
              class="inline-asset-occurrence-settings"
            >
              <legend>
                {{ selectedInlineAsset.assetName }} {{ selectedInlineAsset.occurrence + 1 }} の個別設定
              </legend>
              <label>
                倍率（{{ Math.round((selectedInlineAssetStyle?.scale ?? selectedInlineAssetDefinition.scale) * 100) }}%）
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  :value="selectedInlineAssetStyle?.scale ?? selectedInlineAssetDefinition.scale"
                  @input="updateSelectedInlineAssetStyle('scale', $event)"
                >
              </label>
              <label>
                上下位置（{{ (selectedInlineAssetStyle?.baselineOffset ?? selectedInlineAssetDefinition.baselineOffset).toFixed(2) }}em）
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  :value="selectedInlineAssetStyle?.baselineOffset ?? selectedInlineAssetDefinition.baselineOffset"
                  @input="updateSelectedInlineAssetStyle('baselineOffset', $event)"
                >
              </label>
              <label>
                左右余白（{{ (selectedInlineAssetStyle?.inlinePadding ?? selectedInlineAssetDefinition.inlinePadding).toFixed(2) }}em）
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="selectedInlineAssetStyle?.inlinePadding ?? selectedInlineAssetDefinition.inlinePadding"
                  @input="updateSelectedInlineAssetStyle('inlinePadding', $event)"
                >
              </label>
              <button
                type="button"
                :disabled="!selectedInlineAssetStyle"
                @click="resetSelectedInlineAssetStyle"
              >
                アセットの既定値に戻す
              </button>
            </fieldset>
            <p v-else class="muted">
              日本語訳内のトークンへカーソルを置くか、「訳文内で使用中」から選んで個別調整します。
            </p>
          </section>
          <fieldset class="partial-text-style">
            <legend>選択文字の装飾</legend>
            <small>日本語訳の文字を選択してから色またはフォントを適用します。</small>
            <div class="partial-text-style-controls">
              <div class="color-field">
                <label for="partial-text-color">色</label>
                <span class="color-picker-control">
                  <input
                    id="partial-text-color"
                    v-model="partialTextColor"
                    type="color"
                  >
                  <button
                    type="button"
                    :disabled="!eyeDropperSupported"
                    title="画面上の1点から色を取得"
                    @click="pickTextColor(true)"
                  >
                    スポイト
                  </button>
                </span>
              </div>
              <button
                type="button"
                :disabled="textSelection.start === textSelection.end"
                @click="applySelectionStyle({ textColor: partialTextColor })"
              >
                色を適用
              </button>
            </div>
            <div class="partial-text-style-controls">
              <label>
                フォント
                <select v-model="partialFontId">
                  <option value="">標準フォント</option>
                  <option v-for="font in fonts" :key="font.id" :value="font.id">
                    {{ font.displayName }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                :disabled="textSelection.start === textSelection.end"
                @click="applySelectionStyle({ fontId: partialFontId || null })"
              >
                フォントを適用
              </button>
            </div>
            <button
              type="button"
              :disabled="textSelection.start === textSelection.end"
              @click="applySelectionStyle(null)"
            >
              選択部分の装飾を解除
            </button>
          </fieldset>
          <small v-if="eyeDropperError" class="font-error">
            {{ eyeDropperError }}
          </small>
        </div>
        <div class="field-row">
          <label v-if="region.backgroundMode === 'solid'">
            背景色
            <input
              type="color"
              :value="region.backgroundColor"
              @change="update('backgroundColor', $event)"
            >
          </label>
          <div class="color-field">
            <label for="region-text-color">文字色</label>
            <span class="color-picker-control">
              <input
                id="region-text-color"
                type="color"
                :value="region.textColor"
                @change="update('textColor', $event)"
              >
              <button
                type="button"
                :disabled="!eyeDropperSupported"
                title="画面上の1点から色を取得"
                @click="pickTextColor(false)"
              >
                スポイト
              </button>
            </span>
          </div>
        </div>
        <div class="field-row">
          <label>
            縁取り色
            <input
              type="color"
              :value="region.textStrokeColor"
              @change="update('textStrokeColor', $event)"
            >
          </label>
          <label>
            縁取り太さ
            <input
              type="number"
              min="0"
              max="12"
              step="0.5"
              :value="region.textStrokeWidth"
              @change="update('textStrokeWidth', $event)"
            >
          </label>
        </div>
        <label v-if="region.ruby || !region.autoFitFontSize || regionTextLayout(region) !== 'single-line'">
          {{ region.ruby ? 'ルビのフォントサイズ（上限）' : 'フォントサイズ' }}
          <input
            type="number"
            :min="region.ruby ? 1 : 8"
            max="200"
            :value="region.ruby ? rubyFontSize(region) : region.fontSize"
            @change="update(region.ruby ? 'rubyFontSize' : 'fontSize', $event)"
          >
        </label>
        <label v-if="!region.ruby" class="checkbox-field font-size-auto-fit">
          <span>
            <input
              type="checkbox"
              :checked="region.autoFitFontSize"
              @change="updateBoolean('autoFitFontSize', $event)"
            >
            領域内に収まるよう自動調整
          </span>
          <small v-if="regionTextLayout(region) === 'single-line'">一行の訳文が領域の幅・高さに収まる最大サイズに調整します。手動指定する場合は自動調整を外してください。</small>
          <small v-else>入力したフォントサイズを上限として、必要な場合だけ縮小します。</small>
        </label>
        <p v-else class="muted">
          ルビは指定サイズを上限として、原文の上の表示範囲に一行で収まるよう必要に応じて縮小します。
        </p>
        <label>
          フォント
          <select :value="region.fontId ?? ''" @change="updateFont">
            <option value="">標準フォント</option>
            <option v-for="font in fonts" :key="font.id" :value="font.id">
              {{ font.displayName
              }}{{ loadedFontIds.has(font.id) ? '' : '（未読込）' }}
            </option>
          </select>
          <small v-if="region.fontId && !loadedFontIds.has(region.fontId)">
            フォントライブラリからファイルを再選択してください。
          </small>
        </label>
        <div class="field-row">
          <label>
            横位置
            <select :value="region.textAlign" @change="updateAlign">
              <option value="left">左</option>
              <option value="center">中央</option>
              <option value="right">右</option>
            </select>
          </label>
          <label>
            縦位置
            <select
              :value="region.verticalAlign"
              @change="updateVerticalAlign"
            >
              <option value="top">上</option>
              <option value="middle">中央</option>
              <option value="bottom">下</option>
            </select>
          </label>
        </div>
      </div>
      <div v-show="activeTab === 'region'" class="inspector-tab-panel">
        <dl class="region-coordinates">
          <div>
            <dt>x</dt>
            <dd>{{ region.x }}</dd>
          </div>
          <div>
            <dt>y</dt>
            <dd>{{ region.y }}</dd>
          </div>
          <div>
            <dt>幅</dt>
            <dd>{{ region.width }}</dd>
          </div>
          <div>
            <dt>高さ</dt>
            <dd>{{ region.height }}</dd>
          </div>
        </dl>
      </div>
    </form>
  </section>
</template>

<style scoped>
.consistency-warnings li {
  white-space: pre-line;
}

.inspector-tab-panel {
  min-width: 0;
}

.text-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.text-field-heading label {
  margin: 0;
}

.inline-asset-editor {
  display: grid;
  margin-top: 0.35rem;
  gap: 0.65rem;
}

.inline-asset-editor h3,
.inline-asset-editor p {
  margin: 0;
}

.inline-asset-occurrences {
  display: grid;
  gap: 0.35rem;
  font-size: 0.75rem;
}

.inline-asset-occurrences > span {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.inline-asset-occurrences button {
  padding: 0.3rem 0.45rem;
  font-size: 0.7rem;
}

.inline-asset-occurrences button.selected {
  border-color: #3970d5;
  color: #174ea6;
  background: #edf3ff;
}

.inline-asset-occurrence-settings {
  display: grid;
  margin: 0;
  padding: 0.6rem;
  border: 1px solid #9fb5d8;
  border-radius: 0.4rem;
  gap: 0.55rem;
  background: #f8fbff;
}

.inline-asset-occurrence-settings label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.72rem;
}
</style>
