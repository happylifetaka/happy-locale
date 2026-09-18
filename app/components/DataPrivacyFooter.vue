<script setup lang="ts">
/** 配信設定で外部の翻訳接続機能が有効になっているか。 */
const translationEndpointEnabled
  = String(useRuntimeConfig().public.translationEndpointEnabled) === 'true'
</script>

<template>
  <footer class="data-privacy-footer">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5.5 5.5v5.7c0 4.3 2.7 8.1 6.5 9.8 3.8-1.7 6.5-5.5 6.5-9.8V5.5L12 3Z" />
      <path d="m9.2 12 1.8 1.8 3.9-4" />
    </svg>
    <div class="data-privacy-footer__messages">
      <p>
        データは端末内で処理します。<template v-if="translationEndpointEnabled">
          外部翻訳の利用時のみ、原文と言語を指定先へ送信します。
        </template>
      </p>
      <p>
        画像・フォントおよび成果物の利用条件（著作権・利用規約）を確認のうえ、ご自身の責任でご利用ください。
      </p>
    </div>
  </footer>
</template>
