import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a running Sellora AI stack (web + API + worker).
 * Start it first (npm run dev or production), then: npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
