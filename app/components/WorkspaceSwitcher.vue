<script setup lang="ts">
const route = useRoute()

/** 現在のURLに対応する作業画面のパス。 */
const currentWorkspace = computed(() => {
  if (route.path.startsWith('/cards'))
    return '/cards'
  if (route.path.startsWith('/pdf'))
    return '/pdf'
  return '/'
})

/** 作業画面の選択に応じたページへ遷移する。 */
async function switchWorkspace(event: Event) {
  const select = event.target as HTMLSelectElement
  const destination = select.value
  // Keep the current workspace displayed while the leave dialog is pending.
  select.value = currentWorkspace.value
  if (destination !== currentWorkspace.value)
    await navigateTo(destination)
}
</script>

<template>
  <div class="workspace-switcher">
    <NuxtLink class="workspace-switcher-mark" to="/" aria-label="HappyLocale ホーム">
      <BrandMark />
    </NuxtLink>
    <select
      :value="currentWorkspace"
      aria-label="作業を切り替える"
      @change="switchWorkspace"
    >
      <option value="/">
        ホーム
      </option>
      <option value="/cards">
        カード編集
      </option>
      <option value="/pdf">
        PDF翻訳
      </option>
    </select>
  </div>
</template>
