<script setup lang="ts">
const route = useRoute()

/** カード編集画面は専用ツールバーを持つため、共通ナビゲーションとの二重表示を避ける。 */
const showHomeNavigation = computed(() =>
  !route.path.startsWith('/cards'),
)
</script>

<template>
  <div class="application-shell">
    <AppNavigation v-if="showHomeNavigation" />
    <div class="application-content">
      <NuxtPage />
    </div>
  </div>
</template>
