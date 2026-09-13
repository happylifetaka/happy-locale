<script setup lang="ts">
const route = useRoute()

/** 現在のURLから求めたナビゲーションの選択先。 */
const activeWorkspace = computed(() => {
  if (route.path.startsWith('/cards'))
    return 'cards'
  if (route.path.startsWith('/pdf'))
    return 'pdf'
  return 'home'
})
</script>

<template>
  <header class="app-navigation">
    <NuxtLink class="app-navigation-brand" to="/" aria-label="HappyLocale ホーム">
      <BrandMark class="app-navigation-mark" />
      <span>HappyLocale</span>
    </NuxtLink>
    <nav class="workspace-navigation" aria-label="作業を切り替える">
      <NuxtLink
        to="/cards"
        :class="{ active: activeWorkspace === 'cards' }"
        :aria-current="activeWorkspace === 'cards' ? 'page' : undefined"
      >
        カード編集
      </NuxtLink>
      <NuxtLink
        to="/pdf"
        :class="{ active: activeWorkspace === 'pdf' }"
        :aria-current="activeWorkspace === 'pdf' ? 'page' : undefined"
      >
        PDF翻訳
      </NuxtLink>
    </nav>
  </header>
</template>
