import type { FontReference } from '~/types/editor'
import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'

/** フォントキャッシュ用IndexedDBのデータベース名。 */
const databaseName = 'happy-locale-font-cache'
/** フォントBlobを保存するオブジェクトストア名。 */
const storeName = 'fonts'
/** フォントキャッシュのスキーマ更新に使うバージョン。 */
const databaseVersion = 1

interface CachedFontRecord {
  id: string
  blob: Blob
  updatedAt: number
}

/** フォントキャッシュ用のIndexedDBを開き、必要なら保存領域を作る。 */
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('このブラウザではフォントを保存できません。'))

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName))
        database.createObjectStore(storeName, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('フォント保存領域を開けませんでした。'))
  })
}

/** 要求成功だけでは保存完了とせず、IndexedDBトランザクションの完了まで待つ。 */
async function useStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      let result: T
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => reject(request.error ?? new Error('フォント保存処理に失敗しました。'))
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(transaction.error ?? new Error('フォント保存処理が中断されました。'))
    })
  }
  finally {
    database.close()
  }
}

/** フォントBlobを容量検証後にIndexedDBへ保存する。 */
export async function cacheFont(id: string, blob: Blob): Promise<void> {
  assertFileSize(blob, FILE_LIMITS.fontBytes, 'フォント')
  await useStore('readwrite', store => store.put({
    id,
    blob,
    updatedAt: Date.now(),
  } satisfies CachedFontRecord))
}

/** 指定IDで保存されたフォントBlobを取り出す。 */
export async function getCachedFont(id: string): Promise<Blob | null> {
  const record = await useStore<CachedFontRecord | undefined>(
    'readonly',
    store => store.get(id),
  )
  return record?.blob instanceof Blob ? record.blob : null
}

/** 指定IDのフォントをブラウザのキャッシュから削除する。 */
export async function removeCachedFont(id: string): Promise<void> {
  await useStore('readwrite', store => store.delete(id))
}

/** 保存済みフォントをFontFaceへ戻し、Canvasでも利用できるようdocument.fontsへ登録する。 */
export async function loadCachedFont(
  reference: FontReference,
): Promise<FontFace | null> {
  const blob = await getCachedFont(reference.id)
  if (!blob)
    return null
  assertFileSize(blob, FILE_LIMITS.fontBytes, 'フォント')
  const face = new FontFace(reference.familyName, await blob.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  return face
}
