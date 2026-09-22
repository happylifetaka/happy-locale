import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    // 通常の機能検証は設定済み利用者として開始。初回設定のspecは空の状態へ上書きする。
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://127.0.0.1:3000',
        localStorage: [{ name: 'happy-locale.translation-settings.v1', value: JSON.stringify({ provider: 'manual', endpoint: 'http://localhost:4578' }) }],
      }],
    },
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
