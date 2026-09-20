/** 保存形式の公開窓口。内部配置を変えてもimport先・JSON形式・検証順を維持する。 */
export { parseFolderProject, serializeFolderProject, toCardProject } from './format/codec'
export { CURRENT_PROJECT_VERSION } from './format/migrations'
export { isSafeAssetImagePath, isSafeCardImagePath, isSafeProjectPath } from './format/paths'
