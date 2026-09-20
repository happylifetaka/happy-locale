import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Explicit opt-in: measurements are not timing assertions in the normal E2E suite.
export default defineConfig({
  ...base,
  testDir: './tests/performance',
  workers: 1,
  timeout: 120000,
  reporter: [['list'], ['json', { outputFile: 'test-results/performance.json' }]],
})
