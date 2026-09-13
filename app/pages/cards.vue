<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <main class="app-shell">
    <CardEditor :open-sample-on-mount="route.query.demo === '1'" />
  </main>
</template>
