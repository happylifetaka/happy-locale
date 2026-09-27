import { defineConfig } from '@playwright/test'

// Build first with NUXT_APP_BASE_URL=/happy-locale-public/ pnpm build:static.
export default defineConfig({
  testDir: './tests/public',
  outputDir: './test-results/public',
  workers: 1,
  timeout: 60000,
  use: {
    actionTimeout: 10000,
    baseURL: 'http://127.0.0.1:3101/happy-locale-public/',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/public/server.mjs',
    url: 'http://127.0.0.1:3101/happy-locale-public/',
    reuseExistingServer: false,
  },
})
