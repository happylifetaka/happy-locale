import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/.git/**'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
