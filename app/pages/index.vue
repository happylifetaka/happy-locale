<template>
  <main class="home-page">
    <section class="home-introduction">
      <h1 class="home-eyebrow">
        カード翻訳支援ツール
      </h1>
      <p>
        カード画像に訳文を配置して、画像や印刷用PDFに。
      </p>
    </section>

    <section class="workspace-choices" aria-label="作業を選択">
      <article class="workspace-choice-card">
        <div class="workspace-choice-heading">
          <div class="workspace-choice-icon cards" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p class="workspace-choice-label">
              画像の読み込みから印刷まで
            </p>
            <h2>カード編集</h2>
          </div>
        </div>
        <p>
          複数のカードをまとめて管理しながら、訳文や文字の配置を調整できます。
        </p>
        <ul>
          <li>画像の文字を読み取り、翻訳する範囲を選択</li>
          <li>訳文を入力、またはブラウザ内翻訳で下訳を作成</li>
          <li>レイアウトを整え、画像やA4印刷用PDFに書き出し</li>
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
