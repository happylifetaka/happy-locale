import type {
  CardProject,
  FolderProjectCard,
  FolderProjectDocument,
  FontReference,
  ImageAsset,
} from '~/types/editor'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'
import { readImageDpi } from '~/utils/image-dpi'
import {
  isSafeAssetImagePath,
  isSafeCardImagePath,
  parseFolderProject,
  serializeFolderProject,
} from './format'

export interface OpenedFolderProject {
  directory: FileSystemDirectoryHandle
  document: FolderProjectDocument
  card: FolderProjectCard
  imageFile: File
  assetFiles: Map<string, File>
}

export interface FolderProjectCardAddition {
  id: string
  file: File
  imageWidth: number
  imageHeight: number
}

type DirectoryPickerWindow = Window
  & typeof globalThis & {
    showDirectoryPicker?: (options?: {
      id?: string
      mode?: 'read' | 'readwrite'
    }) => Promise<FileSystemDirectoryHandle>
  }

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}

/** ブラウザがフォルダ選択と読み書きのAPIに対応しているか調べる。 */
export function supportsFolderProjects(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** プロジェクトの保存先を読み書き権限付きで選択する。 */
export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker)
    throw new Error('このブラウザはフォルダプロジェクトに未対応です。')
  return picker.call(window, {
    id: 'happy-locale-project',
    mode: 'readwrite',
  })
}

/** カード画像を列挙するフォルダを読み取り用に選択する。 */
export async function pickImageDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker)
    throw new Error('このブラウザはフォルダ選択に未対応です。')
  return picker.call(window, {
    id: 'happy-locale-card-images',
    mode: 'read',
  })
}

/** フォルダ直下の対応画像を列挙し、自然な名前順へ並べる。 */
export async function listImageFiles(
  directory: FileSystemDirectoryHandle,
): Promise<File[]> {
  const files: File[] = []
  const values = (directory as IterableDirectoryHandle).values?.()
  if (!values)
    throw new Error('このブラウザはフォルダ内ファイルの列挙に未対応です。')
  for await (const entry of values) {
    if (entry.kind !== 'file' || !/\.(?:png|jpe?g)$/iu.test(entry.name))
      continue
    const file = await entry.getFile()
    if (file.type && !['image/png', 'image/jpeg'].includes(file.type))
      continue
    files.push(file)
    if (files.length > FILE_LIMITS.projectCards)
      throw new Error(`一度に選択できる画像は${FILE_LIMITS.projectCards}件までです。`)
  }
  return files.sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { numeric: true }))
}

/** 指定フォルダにproject.jsonが存在するか確認する。 */
export async function folderProjectExists(
  directory: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    await directory.getFileHandle('project.json')
    return true
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError')
      return false
    throw error
  }
}

/** 容量を検証してフォルダ内のテキストファイルを読む。 */
async function readTextFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  const file = await (await directory.getFileHandle(name)).getFile()
  assertFileSize(file, FILE_LIMITS.textBytes, name)
  return file.text()
}

/** 書き込みとcloseを一組として扱い、失敗時はストリームを中断して呼び出し元へ伝える。 */
async function writeFile(
  handle: FileSystemFileHandle,
  contents: Blob | string,
) {
  const writable = await handle.createWritable()
  try {
    await writable.write(contents)
    await writable.close()
  }
  catch (error) {
    try {
      await writable.abort()
    }
    catch {
      // The stream may already be closed by the browser after a write failure.
    }
    throw error
  }
}

/** 階層を順にたどり、フォルダ内の相対パスからファイルを取得する。 */
async function getFileByPath(
  directory: FileSystemDirectoryHandle,
  path: string,
): Promise<File> {
  const parts = path.split('/')
  let current = directory
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part)
  }
  return (await current.getFileHandle(parts.at(-1)!)).getFile()
}

/** カードの画像パスを検証して元ファイルを読む。 */
export async function loadFolderProjectCardImage(
  directory: FileSystemDirectoryHandle,
  card: FolderProjectCard,
): Promise<File> {
  if (!isSafeCardImagePath(card.imagePath))
    throw new Error(`安全でないカード画像パスを拒否しました: ${card.imagePath}`)
  return getFileByPath(directory, card.imagePath)
}

/** 安全なカードIDからサムネイルのファイル名を作る。 */
export function cardThumbnailFileName(cardId: string): string | null {
  return /^\w[\w-]{0,127}$/u.test(cardId)
    ? `${cardId}.jpg`
    : null
}

/** 任意のサムネイルキャッシュを読み、なければnullを返す。 */
export async function loadFolderProjectCardThumbnail(
  directory: FileSystemDirectoryHandle,
  cardId: string,
): Promise<File | null> {
  const fileName = cardThumbnailFileName(cardId)
  if (!fileName)
    return null
  try {
    const file = await getFileByPath(directory, `thumbnails/${fileName}`)
    assertFileSize(file, FILE_LIMITS.imageBytes, 'サムネイル画像')
    return file
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError')
      return null
    throw error
  }
}

/** カードIDを検証し、サムネイルをフォルダへ保存する。 */
export async function writeFolderProjectCardThumbnail(
  directory: FileSystemDirectoryHandle,
  cardId: string,
  thumbnail: Blob,
): Promise<boolean> {
  const fileName = cardThumbnailFileName(cardId)
  if (!fileName)
    return false
  const thumbnails = await directory.getDirectoryHandle('thumbnails', {
    create: true,
  })
  await writeFile(
    await thumbnails.getFileHandle(fileName, { create: true }),
    thumbnail,
  )
  return true
}

/** 文書検証後、選択中のカードとアセットを読み込む。他のカード画像は切り替え時に読む。 */
export async function openFolderProject(
  directory: FileSystemDirectoryHandle,
): Promise<OpenedFolderProject> {
  const document = parseFolderProject(
    await readTextFile(directory, 'project.json'),
  )
  const card = document.cards.find(item => item.id === document.activeCardId)!
  const imageFile = await loadFolderProjectCardImage(directory, card)
  const assetFiles = new Map<string, File>()
  for (const asset of document.assets) {
    try {
      if (!isSafeAssetImagePath(asset.imagePath))
        throw new Error(`安全でないアセット画像パスを拒否しました: ${asset.imagePath}`)
      const file = await getFileByPath(directory, asset.imagePath)
      assertFileSize(file, FILE_LIMITS.imageBytes, 'アセット画像')
      assetFiles.set(asset.id, file)
    }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        throw error
      }
    }
  }
  return { directory, document, card, imageFile, assetFiles }
}

/** 画像のMIME型または名前から保存用拡張子を選ぶ。 */
function extensionFor(file: File): string {
  if (file.type === 'image/png')
    return '.png'
  if (file.type === 'image/jpeg')
    return '.jpg'
  const extension = file.name.match(/\.(png|jpe?g)$/iu)?.[0]
  return extension?.toLowerCase() === '.jpeg'
    ? '.jpg'
    : (extension?.toLowerCase() ?? '.png')
}

/** 既存project.jsonがあるフォルダへの初回保存を拒否し、新規の画像と文書を作成する。 */
export async function createFolderProject(
  directory: FileSystemDirectoryHandle,
  project: CardProject,
  sourceImage: File,
  cardId: string,
  assets: ImageAsset[],
  fonts: FontReference[],
  ocrDictionary: FolderProjectDocument['ocrDictionary'],
  assetBlobs: ReadonlyMap<string, Blob>,
  glossary: FolderProjectDocument['glossary'] = [],
): Promise<FolderProjectDocument> {
  try {
    await directory.getFileHandle('project.json')
    throw new Error(
      'このフォルダには既にproject.jsonがあります。「プロジェクトを開く」を使用してください。',
    )
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw error
    }
  }
  const images = await directory.getDirectoryHandle('images', { create: true })
  const imagePath = `images/${cardId}${extensionFor(sourceImage)}`
  await writeFile(
    await images.getFileHandle(imagePath.split('/').at(-1)!, { create: true }),
    sourceImage,
  )
  const document: FolderProjectDocument = {
    version: 2,
    name: directory.name,
    activeCardId: cardId,
    cards: [{
      id: cardId,
      imagePath,
      ...project,
      printArea: null,
      sourceDpi: await readImageDpi(sourceImage),
    }],
    assets,
    fonts,
    ocrDictionary,
    glossary,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
  }
  await writeAssetFiles(directory, assets, assetBlobs)
  await writeProjectDocument(directory, document, false)
  return document
}

/** 新しい画像パスへ退避してから文書を更新する。旧画像の削除は文書の保存成功後に行う。 */
export async function saveFolderProject(
  directory: FileSystemDirectoryHandle,
  document: FolderProjectDocument,
  project: CardProject,
  assets: ImageAsset[],
  fonts: FontReference[],
  ocrDictionary: FolderProjectDocument['ocrDictionary'],
  assetBlobs: ReadonlyMap<string, Blob>,
  deletedCards: readonly FolderProjectCard[] = [],
  glossary: FolderProjectDocument['glossary'] = document.glossary,
): Promise<FolderProjectDocument> {
  // Read the persisted snapshot: the editor document already omits deleted assets.
  const previous = parseFolderProject(await readTextFile(directory, 'project.json'))
  const stagedAssets = assets.map(asset => assetBlobs.has(asset.id)
    ? { ...asset, imagePath: `assets/${crypto.randomUUID()}.png` }
    : asset)
  const updated: FolderProjectDocument = {
    ...document,
    cards: document.cards.map(card =>
      card.id === document.activeCardId ? { ...card, ...project } : card,
    ),
    assets: stagedAssets,
    fonts,
    ocrDictionary,
    glossary,
  }
  try {
    await writeAssetFiles(directory, stagedAssets, assetBlobs)
    await writeProjectDocument(directory, updated, true)
  }
  catch (error) {
    // Only new paths were written, so failed saves never overwrite saved images.
    await removeFolderProjectAssetImages(directory, stagedAssets.filter(asset => assetBlobs.has(asset.id)), [])
      .catch(() => { /* Keep the original save error if cleanup also fails. */ })
    throw error
  }
  await removeFolderProjectAssetImages(directory, previous.assets, stagedAssets)
  await removeFolderProjectCardImages(directory, deletedCards)
  return updated
}

/** 追加画像のメタデータを組み立て、未保存アセットも通常保存と同じ手順で確定する。 */
export async function addFolderProjectCards(
  directory: FileSystemDirectoryHandle,
  document: FolderProjectDocument,
  additions: readonly FolderProjectCardAddition[],
  assetBlobs: ReadonlyMap<string, Blob> = new Map(),
): Promise<FolderProjectDocument> {
  if (additions.length === 0)
    return document
  const images = await directory.getDirectoryHandle('images', { create: true })
  const cards: FolderProjectCard[] = []
  for (const addition of additions) {
    const imagePath = `images/${addition.id}${extensionFor(addition.file)}`
    await writeFile(
      await images.getFileHandle(imagePath.split('/').at(-1)!, {
        create: true,
      }),
      addition.file,
    )
    cards.push({
      id: addition.id,
      imagePath,
      imageName: addition.file.name,
      imageWidth: addition.imageWidth,
      imageHeight: addition.imageHeight,
      regions: [],
      printArea: null,
      sourceDpi: await readImageDpi(addition.file),
    })
  }
  const updated = {
    ...document,
    cards: [...document.cards, ...cards],
  }
  return saveFolderProject(
    directory,
    updated,
    updated.cards.find(card => card.id === updated.activeCardId)!,
    document.assets,
    document.fonts,
    document.ocrDictionary,
    assetBlobs,
  )
}

/** IDが同じ再切り出しもあるため、現行文書で使われている画像パスとの比較で削除を決める。 */
export async function removeFolderProjectAssetImages(
  directory: FileSystemDirectoryHandle,
  previous: readonly ImageAsset[],
  current: readonly ImageAsset[],
) {
  const currentPaths = new Set(current.map(asset => asset.imagePath))
  for (const asset of previous) {
    if (currentPaths.has(asset.imagePath))
      continue
    if (!isSafeAssetImagePath(asset.imagePath)) {
      throw new Error(`安全でないアセット画像パスの削除を拒否しました: ${asset.imagePath}`)
    }
    await removeFileByPath(directory, asset.imagePath)
  }
}

/** 指定パスのファイルを削除し、既にない場合は完了として扱う。 */
async function removeFileByPath(
  directory: FileSystemDirectoryHandle,
  path: string,
) {
  const parts = path.split('/')
  let parent = directory
  try {
    for (const part of parts.slice(0, -1)) {
      parent = await parent.getDirectoryHandle(part)
    }
    await parent.removeEntry(parts.at(-1)!)
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw error
    }
  }
}

/** 削除したカードの元画像とサムネイルを取り除く。 */
export async function removeFolderProjectCardImages(
  directory: FileSystemDirectoryHandle,
  cards: readonly FolderProjectCard[],
) {
  for (const card of cards) {
    if (!isSafeCardImagePath(card.imagePath)) {
      throw new Error(`安全でないカード画像パスの削除を拒否しました: ${card.imagePath}`)
    }
  }
  for (const card of cards) {
    await removeFileByPath(directory, card.imagePath)
    const thumbnailFileName = cardThumbnailFileName(card.id)
    if (thumbnailFileName)
      await removeFileByPath(directory, `thumbnails/${thumbnailFileName}`)
  }
}

/** 保存待ちBlobがあるアセットだけを指定された画像パスへ書く。 */
async function writeAssetFiles(
  directory: FileSystemDirectoryHandle,
  assets: readonly ImageAsset[],
  blobs: ReadonlyMap<string, Blob>,
) {
  if (blobs.size === 0)
    return
  const assetDirectory = await directory.getDirectoryHandle('assets', {
    create: true,
  })
  for (const asset of assets) {
    const blob = blobs.get(asset.id)
    if (!blob)
      continue
    if (!isSafeAssetImagePath(asset.imagePath))
      throw new Error(`安全でないアセット画像パスへの保存を拒否しました: ${asset.imagePath}`)
    await writeFile(
      await assetDirectory.getFileHandle(asset.imagePath.split('/').at(-1)!, {
        create: true,
      }),
      blob,
    )
  }
}

/** 更新前のJSONをバックアップしてから新JSONを書く。画像ファイルの退避は呼び出し元が担う。 */
async function writeProjectDocument(
  directory: FileSystemDirectoryHandle,
  document: FolderProjectDocument,
  createBackup: boolean,
) {
  if (createBackup) {
    try {
      const previous = await readTextFile(directory, 'project.json')
      await writeFile(
        await directory.getFileHandle('project.backup.json', { create: true }),
        previous,
      )
    }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        throw error
      }
    }
  }
  await writeFile(
    await directory.getFileHandle('project.json', { create: true }),
    serializeFolderProject(document),
  )
}
