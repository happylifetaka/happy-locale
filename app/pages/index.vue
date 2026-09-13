<template>
  <main class="home-page">
    <section class="home-introduction">
      <p class="home-eyebrow">
        カード・PDF翻訳支援ツール
      </p>
      <h1>何を編集しますか？</h1>
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

      <article class="workspace-choice-card">
        <div class="workspace-choice-icon pdf" aria-hidden="true">
          <span>PDF</span>
        </div>
        <div>
          <p class="workspace-choice-label">
            文書から作る
          </p>
          <h2>PDF翻訳</h2>
          <p>
            PDFから文字を抽出してCSV出力。
            利用者がCSV上で翻訳後、元のページへ訳文を配置します。
          </p>
        </div>
        <ul>
          <li>文字PDF・画像PDFの判定</li>
          <li>検索可能な訳文の埋め込み</li>
        </ul>
        <NuxtLink class="button primary workspace-choice-action" to="/pdf">
          PDF翻訳を始める
        </NuxtLink>
      </article>
    </section>
    <DataPrivacyFooter />
  </main>
</template>
