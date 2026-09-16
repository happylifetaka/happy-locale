<script setup lang="ts">
import type {
  AssetCreationDraft,
  ImageAsset,
  RegionDraft,
} from '~/types/editor'

defineProps<{
  image: HTMLImageElement | null
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  zoom: number
  selecting: boolean
  creationDraft: AssetCreationDraft | null
  creationRunning?: boolean
}>()

const emit = defineEmits<{
  'toggleSelecting': []
  'image': [file: File]
  'add': [bounds: RegionDraft]
  'updateDraft': [patch: Partial<AssetCreationDraft>]
  'confirmDraft': []
  'cancelDraft': []
  'rename': [id: string, name: string]
  'update': [id: string, patch: Partial<ImageAsset>]
  'recrop': [id: string]
  'remove': [id: string]
  'update:zoom': [value: number]
}>()

/** 入力された表示名の変更を親へ通知する。 */
function rename(id: string, name: string) {
  emit('rename', id, name)
}

/** 入力された設定項目の変更を親へ通知する。 */
function update(id: string, patch: Partial<ImageAsset>) {
  emit('update', id, patch)
}
</script>

<template>
  <div class="asset-editor-layout">
    <AssetSourceCanvas
      :image="image"
      :zoom="zoom"
      :selecting="selecting"
      @image="$emit('image', $event)"
      @select="$emit('add', $event)"
      @update-zoom="$emit('update:zoom', $event)"
    />
    <aside class="side-panel asset-editor-panel">
      <h2>アセット編集</h2>
      <AssetCreationPanel
        v-if="image && creationDraft"
        :image="image"
        :draft="creationDraft"
        :existing-assets="assets"
        :running="creationRunning"
        @update="$emit('updateDraft', $event)"
        @confirm="$emit('confirmDraft')"
        @cancel="$emit('cancelDraft')"
      />
      <button
        v-else
        type="button"
        class="asset-create-button"
        :class="{ primary: selecting }"
        :disabled="!image"
        @click="$emit('toggleSelecting')"
      >
        {{
          selecting
            ? '元画像上をドラッグしてください'
            : '新しいアセットを切り出す'
        }}
      </button>
      <p v-if="!creationDraft" class="muted">
        カード画像とは別の切り出し元画像を読み込みます。
      </p>
      <AssetLibrary
        :assets="assets"
        :asset-images="assetImages"
        :image="image"
        :asset-editing="false"
        :selected-region="null"
        :show-create="false"
        :show-insert="false"
        :show-adjustments="true"
        :show-recrop="true"
        @rename="rename"
        @update="update"
        @recrop="$emit('recrop', $event)"
        @remove="$emit('remove', $event)"
      />
    </aside>
  </div>
</template>
