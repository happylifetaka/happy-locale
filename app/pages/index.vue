<template>
  <main class="home-page">
    <section class="home-introduction">
      <p class="home-eyebrow">
        カード翻訳支援ツール
      </p>
      <h1>カードの翻訳を始めましょう</h1>
      <p>
        ブラウザ上で翻訳作業を進められます。
      </p>
    </section>

    <section class="workspace-choices" aria-label="作業を選択">
      <article class="workspace-choice-card">
        <div class="workspace-choice-icon cards" aria-hidden="true">
          <span />
          <span />
        </div>
        <div>
          <p class="workspace-choice-label">
            カード画像から翻訳
          </p>
          <h2>カード編集</h2>
          <p>
            カード画像の翻訳を支援します。
            複数カードをプロジェクトとして管理します。
          </p>
        </div>
        <ul>
          <li>文字領域の編集とOCR</li>
          <li>翻訳後テキストの入力での翻訳、翻訳CSVの入出力での翻訳</li>
          <li>PNG・JPEG書き出し、A4レイアウトPDF作成</li>
        </ul>
        <div class="workspace-choice-actions">
          <NuxtLink class="button primary workspace-choice-action" to="/cards">
            カード編集を始める
          </NuxtLink>
          <NuxtLink class="button workspace-choice-action" to="/cards?demo=1">
            サンプル（デモ）を開く
          </NuxtLink>
        </div>
      </article>
    </section>
    <DataPrivacyFooter />
  </main>
</template>
