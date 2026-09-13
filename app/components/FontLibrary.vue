<script setup lang="ts">
import type { LocalFontData } from '~/services/fonts/local-font'
import type { FontReference } from '~/types/editor'
import { queryLocalFonts, supportsLocalFonts } from '~/services/fonts/local-font'
import { consumeSelectedFile } from '~/utils/file-input'

const props = defineProps<{
  fonts: FontReference[]
  loadedFontIds: Set<string>
}>()

const emit = defineEmits<{
  load: [file: File, fontId: string | null]
  rename: [id: string, displayName: string]
  loadSystem: [font: LocalFontData, fontId: string | null]
  remove: [id: string]
}>()

/** フォントファイルの選択に使用する入力要素。 */
const input = ref<HTMLInputElement | null>(null)
/** 再読み込みする既存フォントID。新規追加時はnull。 */
const targetFontId = ref<string | null>(null)
/** OSから取得したローカルフォントの候補。 */
const localFonts = shallowRef<LocalFontData[]>([])
/** OSフォント一覧を絞り込む検索語。 */
const localFontSearch = ref('')
/** OSフォントの選択画面を開いているか。 */
const localFontPickerOpen = ref(false)
/** OSフォント一覧の取得中か。 */
const localFontLoading = ref(false)
/** OSフォントの取得に失敗した理由。 */
const localFontError = ref('')
/** ブラウザがOSフォントの列挙に対応しているか。 */
const localFontsSupported = ref(false)
/** フォントプレビューの表示を監視するスクロール領域。 */
const localFontResults = ref<HTMLElement | null>(null)
/** 一覧の見本表示用に読み込んだFontFace。 */
const previewFaces = shallowRef(new Map<string, FontFace>())
/** 各フォントで日本語の見本を表示できるかの推定結果。 */
const previewJapaneseSupport = ref(new Map<string, boolean>())
/** 各フォントの見本の待機・読込・利用可否の状態。 */
const previewStatuses = ref(
  new Map<string, 'queued' | 'loading' | 'ready' | 'unsupported'>(),
)
/** 画面付近のOSフォント見本を検出する表示監視。 */
let previewObserver: IntersectionObserver | null = null
/** フォント見本の読み込み待ちと、その要求世代。 */
let previewQueue: Array<{ font: LocalFontData, generation: number }> = []
/** 現在並行して読み込み中のフォント見本数。 */
let activePreviewLoads = 0
/** フォント一覧の閉鎖・更新前の結果を無効化する世代番号。 */
let previewGeneration = 0
/** 見本用family名が衝突しないよう付ける連番。 */
let previewSequence = 0

/** 検索語に一致したOSフォントの一覧。 */
const filteredLocalFonts = computed(() => {
  const query = localFontSearch.value.trim().toLocaleLowerCase()
  return localFonts.value
    .filter(font => !query || [
      font.postscriptName,
      font.fullName,
      font.family,
      font.style,
    ]
      .some(value => value.toLocaleLowerCase().includes(query)))
    .slice(0, 200)
})

// ブラウザ上でOSフォントの利用可否を調べる。
onMounted(() => {
  localFontsSupported.value = supportsLocalFonts()
})

// フォント一覧が表示されたら見本の遅延読み込みを監視する。
watch(localFontResults, async () => {
  await nextTick()
  observeFontPreviewRows()
})

// 検索結果のDOM更新後に見本の表示監視を張り直す。
watch(filteredLocalFonts, async () => {
  await nextTick()
  observeFontPreviewRows()
})

// 部品終了時に見本用フォントと監視を解放する。
onBeforeUnmount(() => {
  clearFontPreviews()
})

/** 指定フォントの見本読み込み状態を更新する。 */
function setPreviewStatus(
  postscriptName: string,
  status: 'queued' | 'loading' | 'ready' | 'unsupported',
) {
  previewStatuses.value = new Map(previewStatuses.value).set(
    postscriptName,
    status,
  )
}

/** フォント見本へ適用するCSSを返す。 */
function previewStyle(font: LocalFontData) {
  const face = previewFaces.value.get(font.postscriptName)
  return face ? { fontFamily: `"${face.family}"` } : undefined
}

/** フォントの日本語対応状況に応じた見本文字を返す。 */
function previewText(font: LocalFontData) {
  const status = previewStatuses.value.get(font.postscriptName)
  if (status === 'ready') {
    return previewJapaneseSupport.value.get(font.postscriptName)
      ? 'あいうえお 漢字 ABC 123'
      : 'ABC 123'
  }
  if (status === 'unsupported')
    return 'プレビュー非対応'
  return status === 'loading' ? '見本を読み込み中…' : '見本を準備中…'
}

/** 指定フォントの描画結果を比較可能な画素情報へ変換する。 */
function renderedTextSignature(
  familyName: string,
  fallback: 'serif' | 'sans-serif' | 'monospace',
) {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 72
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return ''
  context.fillStyle = '#000'
  context.font = `48px "${familyName}", ${fallback}`
  context.textBaseline = 'top'
  context.fillText('あいうえお漢字', 4, 4)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let hash = 2166136261
  for (let index = 0; index < pixels.length; index += 1) {
    hash ^= pixels[index]!
    hash = Math.imul(hash, 16777619)
  }
  return `${context.measureText('あいうえお漢字').width}:${hash >>> 0}`
}

/** 代替フォントとの描画結果を比較して日本語字形の有無を推定し、見本の表示に使う。 */
function supportsJapanesePreview(familyName: string) {
  const signatures = new Set([
    renderedTextSignature(familyName, 'serif'),
    renderedTextSignature(familyName, 'sans-serif'),
    renderedTextSignature(familyName, 'monospace'),
  ])
  return signatures.size === 1 && !signatures.has('')
}

/** OSフォントを見本表示専用のfamily名で読み込む。 */
async function createPreviewFace(font: LocalFontData, familyName: string) {
  const localNames = [...new Set([
    font.postscriptName,
    font.fullName,
    font.family,
  ].filter(Boolean))]
  for (const localName of localNames) {
    try {
      const face = new FontFace(
        familyName,
        `local(${JSON.stringify(localName)})`,
      )
      await face.load()
      return face
    }
    catch {
      // Some fonts cannot be resolved by their local name. Try the font data next.
    }
  }
  const face = new FontFace(
    familyName,
    await (await font.blob()).arrayBuffer(),
  )
  await face.load()
  return face
}

/** フォントの同時読み込みを2件に制限し、閉じた一覧の古い結果は世代番号で破棄する。 */
function drainPreviewQueue() {
  while (activePreviewLoads < 2 && previewQueue.length > 0) {
    const queued = previewQueue.shift()!
    if (queued.generation !== previewGeneration)
      continue
    activePreviewLoads += 1
    setPreviewStatus(queued.font.postscriptName, 'loading')
    const familyName
      = `HappyLocaleFontPreview_${previewGeneration}_${++previewSequence}`
    void createPreviewFace(queued.font, familyName).then((face) => {
      if (queued.generation !== previewGeneration)
        return
      document.fonts.add(face)
      const supportsJapanese = supportsJapanesePreview(face.family)
      previewFaces.value = new Map(previewFaces.value).set(
        queued.font.postscriptName,
        face,
      )
      previewJapaneseSupport.value = new Map(previewJapaneseSupport.value).set(
        queued.font.postscriptName,
        supportsJapanese,
      )
      setPreviewStatus(queued.font.postscriptName, 'ready')
    }).catch(() => {
      if (queued.generation === previewGeneration) {
        setPreviewStatus(queued.font.postscriptName, 'unsupported')
      }
    }).finally(() => {
      activePreviewLoads -= 1
      drainPreviewQueue()
    })
  }
}

/** 未処理フォントの見本読み込みを待機列へ入れる。 */
function queueFontPreview(font: LocalFontData) {
  if (previewStatuses.value.has(font.postscriptName))
    return
  setPreviewStatus(font.postscriptName, 'queued')
  previewQueue.push({ font, generation: previewGeneration })
  drainPreviewQueue()
}

/** スクロールで表示に近づいた行だけフォントを読み込み、OSフォント全件の展開を避ける。 */
function observeFontPreviewRows() {
  previewObserver?.disconnect()
  previewObserver = null
  if (!localFontResults.value)
    return
  const fontsByName = new Map(
    filteredLocalFonts.value.map(font => [font.postscriptName, font]),
  )
  previewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting)
        continue
      const postscriptName = (entry.target as HTMLElement).dataset.fontName
      const font = postscriptName ? fontsByName.get(postscriptName) : undefined
      if (font)
        queueFontPreview(font)
      previewObserver?.unobserve(entry.target)
    }
  }, {
    root: localFontResults.value,
    rootMargin: '48px 0px',
  })
  localFontResults.value.querySelectorAll<HTMLElement>('[data-font-name]')
    .forEach(element => previewObserver?.observe(element))
}

/** 見本用フォントと監視・待機列を解放する。 */
function clearFontPreviews() {
  previewGeneration += 1
  previewQueue = []
  previewObserver?.disconnect()
  previewObserver = null
  for (const face of previewFaces.value.values())
    document.fonts.delete(face)
  previewFaces.value = new Map()
  previewJapaneseSupport.value = new Map()
  previewStatuses.value = new Map()
}

/** 追加または再読込対象のフォントファイルを選択する。 */
function pick(fontId: string | null) {
  targetFontId.value = fontId
  input.value?.click()
}

/** 選択したフォントファイルを親へ通知する。 */
function selected(event: Event) {
  const element = event.target as HTMLInputElement
  const file = consumeSelectedFile(element)
  if (file)
    emit('load', file, targetFontId.value)
  targetFontId.value = null
}

/** 入力された表示名の変更を親へ通知する。 */
function rename(font: FontReference, event: Event) {
  emit('rename', font.id, (event.target as HTMLInputElement).value.trim())
}

/** OSフォントを取得し、選択画面を開く。 */
async function openLocalFonts(fontId: string | null = null) {
  clearFontPreviews()
  targetFontId.value = fontId
  const targetFont = fontId
    ? props.fonts.find(font => font.id === fontId)
    : null
  localFontSearch.value
    = targetFont?.postscriptName ?? targetFont?.displayName ?? ''
  localFontLoading.value = true
  localFontError.value = ''
  try {
    localFonts.value = await queryLocalFonts()
    localFontPickerOpen.value = true
  }
  catch (error) {
    localFontError.value
      = error instanceof Error ? error.message : 'PCフォントを取得できませんでした。'
  }
  finally {
    localFontLoading.value = false
  }
}

/** OSフォント選択画面とプレビューを閉じる。 */
function closeLocalFonts() {
  localFontPickerOpen.value = false
  targetFontId.value = null
  clearFontPreviews()
}

/** 選択したOSフォントを親へ渡す。 */
function selectLocalFont(font: LocalFontData) {
  emit('loadSystem', font, targetFontId.value)
  closeLocalFonts()
}
</script>

<template>
  <section class="font-library">
    <h3>フォント</h3>
    <button type="button" @click="pick(null)">
      フォントファイルを読込
    </button>
    <button
      type="button"
      :disabled="!localFontsSupported || localFontLoading"
      @click="openLocalFonts()"
    >
      {{ localFontLoading ? 'PCフォントを取得中…' : 'PCのフォントから選択' }}
    </button>
    <input
      ref="input"
      class="visually-hidden"
      type="file"
      accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
      @change="selected"
    >
    <p class="muted">
      フォント本体はこのブラウザ内だけに保存され、外部へアップロードされません。
    </p>
    <p v-if="localFontError" class="font-error">
      {{ localFontError }}
    </p>
    <div v-if="localFontPickerOpen" class="local-font-picker">
      <div class="local-font-picker-header">
        <strong>PCフォント</strong>
        <button type="button" @click="closeLocalFonts">
          閉じる
        </button>
      </div>
      <input v-model="localFontSearch" placeholder="フォント名を検索">
      <div ref="localFontResults" class="local-font-results">
        <button
          v-for="font in filteredLocalFonts"
          :key="font.postscriptName"
          type="button"
          :data-font-name="font.postscriptName"
          @focus="queueFontPreview(font)"
          @click="selectLocalFont(font)"
        >
          <strong>{{ font.fullName }}</strong>
          <small>{{ font.family }} · {{ font.style }}</small>
          <span
            class="local-font-result-preview"
            :class="{
              'is-ready': previewStatuses.get(font.postscriptName) === 'ready',
              'is-unsupported': previewStatuses.get(font.postscriptName) === 'unsupported',
            }"
            :style="previewStyle(font)"
          >
            {{ previewText(font) }}
          </span>
        </button>
      </div>
    </div>
    <p v-if="fonts.length === 0" class="muted">
      読み込み済みフォントはありません。
    </p>
    <div v-for="font in fonts" :key="font.id" class="font-item">
      <div class="font-item-header">
        <input :value="font.displayName" @change="rename(font, $event)">
        <button
          v-if="!loadedFontIds.has(font.id)"
          type="button"
          class="font-item-icon"
          :aria-label="`フォント「${font.displayName}」を再読み込み`"
          title="再読み込み"
          @click="font.source === 'user' ? pick(font.id) : openLocalFonts(font.id)"
        >
          ↻
        </button>
        <button
          type="button"
          class="font-item-icon font-item-remove"
          :aria-label="`フォント「${font.displayName}」を削除`"
          title="フォントを削除"
          @click="$emit('remove', font.id)"
        >
          ×
        </button>
      </div>
      <span :class="loadedFontIds.has(font.id) ? 'loaded' : 'missing'">
        {{
          loadedFontIds.has(font.id)
            ? '使用可能'
            : font.source === 'system'
              ? `未読込: ${font.postscriptName}`
              : `未読込: ${font.fileName}`
        }}
      </span>
    </div>
  </section>
</template>
