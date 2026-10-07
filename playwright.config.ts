import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173/flightplanner/', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173/flightplanner/', reuseExistingServer: !process.env.CI },
});
