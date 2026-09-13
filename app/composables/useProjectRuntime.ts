import { shallowRef } from 'vue'

export interface RuntimeLoadedImage {
  element: HTMLImageElement
  file: File
  url: string
}

export type RuntimeAssetImage = ImageBitmap | HTMLCanvasElement

/** 有効な一時URLをブラウザから解放する。 */
function revokeObjectUrl(url: string | null) {
  if (url)
    URL.revokeObjectURL(url)
}

/** 解放可能なビットマップの画像メモリを閉じる。 */
function closeImageBitmap(image: RuntimeAssetImage) {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
    image.close()
}

/** 表示用フォントをブラウザの登録一覧から外す。 */
function removeFontFace(face: FontFace) {
  if (typeof document !== 'undefined')
    document.fonts.delete(face)
}

/** JSONに保存できないブラウザリソースと、まだ保存していない画像Blobの寿命を管理する。 */
export function useProjectRuntime() {
  /** ユーザーが選択した保存先フォルダのハンドル。 */
  const directory = shallowRef<FileSystemDirectoryHandle | null>(null)
  /** 現在のカードの表示・描画用画像要素。 */
  const cardImage = shallowRef<HTMLImageElement | null>(null)
  /** 現在のカード画像に割り当てた一時URL。 */
  const cardImageUrl = shallowRef<string | null>(null)
  /** 現在のカードの保存・DPI取得に使う元ファイル。 */
  const cardSourceFile = shallowRef<File | null>(null)
  /** アセットを切り出す元画像の要素。 */
  const assetSourceImage = shallowRef<HTMLImageElement | null>(null)
  /** アセット切り出し元画像の一時URL。 */
  const assetSourceImageUrl = shallowRef<string | null>(null)
  /** カードIDごとの一覧用サムネイルURL。 */
  const cardThumbnails = shallowRef(new Map<string, string>())
  /** フォルダへの保存を待っているサムネイル画像。 */
  const pendingCardThumbnailBlobs = shallowRef(new Map<string, Blob>())
  /** アセットIDごとに保持する描画用ビットマップまたはCanvas。 */
  const assetImages = shallowRef(new Map<string, RuntimeAssetImage>())
  /** 次回保存時に書き込むアセットIDと画像Blob。 */
  const pendingAssetWrites = shallowRef(new Map<string, Blob>())
  /** フォントIDごとに保持する読み込み済みFontFace。 */
  const loadedFonts = shallowRef(new Map<string, FontFace>())

  /** プロジェクトの保存先フォルダを設定する。 */
  function setDirectory(nextDirectory: FileSystemDirectoryHandle | null) {
    directory.value = nextDirectory
  }

  /** 新画像への差し替え後に旧URLを解放し、表示中の画像を途中で失効させない。 */
  function replaceCardImage(loaded: RuntimeLoadedImage) {
    const previousImage = cardImage.value
    const previousUrl = cardImageUrl.value
    cardImage.value = loaded.element
    cardImageUrl.value = loaded.url
    cardSourceFile.value = loaded.file
    if (previousImage && previousImage !== loaded.element)
      previousImage.removeAttribute('src')
    if (previousUrl !== loaded.url)
      revokeObjectUrl(previousUrl)
  }

  /** 表示中のカード画像と元ファイルの参照を解除する。 */
  function clearCardImage() {
    revokeObjectUrl(cardImageUrl.value)
    cardImage.value?.removeAttribute('src')
    cardImage.value = null
    cardImageUrl.value = null
    cardSourceFile.value = null
  }

  /** 切り出し元画像を差し替え、旧画像のURLを解放する。 */
  function replaceAssetSourceImage(loaded: RuntimeLoadedImage) {
    const previousImage = assetSourceImage.value
    const previousUrl = assetSourceImageUrl.value
    assetSourceImage.value = loaded.element
    assetSourceImageUrl.value = loaded.url
    if (previousImage && previousImage !== loaded.element)
      previousImage.removeAttribute('src')
    if (previousUrl !== loaded.url)
      revokeObjectUrl(previousUrl)
  }

  /** アセット切り出し用の画像と一時URLを解放する。 */
  function clearAssetSourceImage() {
    revokeObjectUrl(assetSourceImageUrl.value)
    assetSourceImage.value?.removeAttribute('src')
    assetSourceImage.value = null
    assetSourceImageUrl.value = null
  }

  /** カードの一覧用サムネイルを登録する。 */
  function setCardThumbnail(cardId: string, thumbnail: Blob) {
    revokeObjectUrl(cardThumbnails.value.get(cardId) ?? null)
    cardThumbnails.value = new Map(cardThumbnails.value).set(
      cardId,
      URL.createObjectURL(thumbnail),
    )
  }

  /** 指定カードのサムネイルを取り除く。 */
  function removeCardThumbnail(cardId: string) {
    revokeObjectUrl(cardThumbnails.value.get(cardId) ?? null)
    const thumbnails = new Map(cardThumbnails.value)
    thumbnails.delete(cardId)
    cardThumbnails.value = thumbnails
    const pending = new Map(pendingCardThumbnailBlobs.value)
    pending.delete(cardId)
    pendingCardThumbnailBlobs.value = pending
  }

  /** 全カードのサムネイルを解除する。 */
  function resetCardThumbnails() {
    cardThumbnails.value.forEach(revokeObjectUrl)
    cardThumbnails.value = new Map()
    pendingCardThumbnailBlobs.value = new Map()
  }

  /** 指定カードのサムネイルを保存待ちとして登録する。 */
  function setPendingCardThumbnail(cardId: string, thumbnail: Blob) {
    pendingCardThumbnailBlobs.value = new Map(
      pendingCardThumbnailBlobs.value,
    ).set(cardId, thumbnail)
  }

  /** 保存待ちサムネイルの一覧を空にする。 */
  function clearPendingCardThumbnails() {
    pendingCardThumbnailBlobs.value = new Map()
  }

  /** アセットの描画用画像を差し替え、使わなくなった旧画像を解放する。 */
  function replaceAssetImages(images: Map<string, RuntimeAssetImage>) {
    assetImages.value.forEach((image, id) => {
      if (images.get(id) !== image)
        closeImageBitmap(image)
    })
    assetImages.value = images
  }

  /** 指定アセットの描画用画像を置き換える。 */
  function setAssetImage(id: string, image: RuntimeAssetImage) {
    const previous = assetImages.value.get(id)
    if (previous && previous !== image)
      closeImageBitmap(previous)
    assetImages.value = new Map(assetImages.value).set(id, image)
  }

  /** 指定アセットの描画用画像を解放して一覧から除く。 */
  function removeAssetImage(id: string) {
    const previous = assetImages.value.get(id)
    if (previous)
      closeImageBitmap(previous)
    const images = new Map(assetImages.value)
    images.delete(id)
    assetImages.value = images
  }

  /** アセット画像を次回保存用のBlobとして登録する。 */
  function setPendingAssetWrite(id: string, blob: Blob) {
    pendingAssetWrites.value = new Map(pendingAssetWrites.value).set(id, blob)
  }

  /** 指定アセットの保存待ちBlobを取り除く。 */
  function removePendingAssetWrite(id: string) {
    const writes = new Map(pendingAssetWrites.value)
    writes.delete(id)
    pendingAssetWrites.value = writes
  }

  /** 未保存のアセット画像一覧を空にする。 */
  function clearPendingAssetWrites() {
    pendingAssetWrites.value = new Map()
  }

  /** 保存開始時と同じBlobだけを待機列から外し、保存中に再編集された画像は次回分として残す。 */
  function acknowledgeAssetWrites(saved: ReadonlyMap<string, Blob>) {
    pendingAssetWrites.value = new Map([...pendingAssetWrites.value].filter(
      ([id, blob]) => saved.get(id) !== blob,
    ))
  }

  /** 読み込み済みフォントを差し替え、不要な旧FontFaceを解除する。 */
  function replaceLoadedFonts(fonts: Map<string, FontFace>) {
    loadedFonts.value.forEach((face, id) => {
      if (fonts.get(id) !== face)
        removeFontFace(face)
    })
    loadedFonts.value = fonts
  }

  /** 指定IDの表示用フォントを登録または差し替える。 */
  function setLoadedFont(id: string, face: FontFace) {
    const previous = loadedFonts.value.get(id)
    if (previous && previous !== face)
      removeFontFace(previous)
    loadedFonts.value = new Map(loadedFonts.value).set(id, face)
  }

  /** 指定フォントを画面と読み込み済み一覧から外す。 */
  function removeLoadedFont(id: string) {
    const face = loadedFonts.value.get(id)
    if (face)
      removeFontFace(face)
    const fonts = new Map(loadedFonts.value)
    fonts.delete(id)
    loadedFonts.value = fonts
  }

  /** プロジェクト終了時にURL・ビットマップ・FontFaceをまとめて解放する。 */
  function dispose() {
    clearCardImage()
    clearAssetSourceImage()
    resetCardThumbnails()
    replaceAssetImages(new Map())
    clearPendingAssetWrites()
    replaceLoadedFonts(new Map())
    directory.value = null
  }

  return {
    directory,
    cardImage,
    cardImageUrl,
    cardSourceFile,
    assetSourceImage,
    assetSourceImageUrl,
    cardThumbnails,
    pendingCardThumbnailBlobs,
    assetImages,
    pendingAssetWrites,
    loadedFonts,
    setDirectory,
    replaceCardImage,
    clearCardImage,
    replaceAssetSourceImage,
    clearAssetSourceImage,
    setCardThumbnail,
    removeCardThumbnail,
    resetCardThumbnails,
    setPendingCardThumbnail,
    clearPendingCardThumbnails,
    replaceAssetImages,
    setAssetImage,
    removeAssetImage,
    setPendingAssetWrite,
    removePendingAssetWrite,
    clearPendingAssetWrites,
    acknowledgeAssetWrites,
    replaceLoadedFonts,
    setLoadedFont,
    removeLoadedFont,
    dispose,
  }
}
