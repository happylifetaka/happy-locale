import { defineStore } from 'pinia'

/** カード編集画面で共有する一時的な道具の設定。文書・履歴・描画資源は保持しない。 */
export const useEditorToolsStore = defineStore('editor-tools', {
  state: () => ({
    maskEditing: false,
    exclusionEditing: false,
    maskBrushSize: 28,
    maskBrushMode: 'paint' as 'paint' | 'erase',
  }),
  actions: {
    toggleMaskEditing() {
      this.maskEditing = !this.maskEditing
      if (this.maskEditing)
        this.exclusionEditing = false
    },
    toggleExclusionEditing() {
      this.exclusionEditing = !this.exclusionEditing
      if (this.exclusionEditing)
        this.maskEditing = false
    },
    stopEditing() {
      this.maskEditing = false
      this.exclusionEditing = false
    },
  },
})
