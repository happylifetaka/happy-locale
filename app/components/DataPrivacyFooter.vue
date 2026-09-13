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
        画像・PDF・プロジェクトデータは端末内で処理されます。<template v-if="translationEndpointEnabled">
          原文テキストと言語が指定先へ送信されます。
        </template>
      </p>
      <p>
        <strong>重要：</strong>本アプリに読み込む画像、PDF、フォント等の利用権限、および作成した成果物の利用については、適用される法令、ライセンス、利用規約等を利用者ご自身で確認してください。
      </p>
    </div>
  </footer>
</template>
