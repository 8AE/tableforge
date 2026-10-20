import { defineConfig } from '@playwright/test';

const port = Number(process.env.TABLEFORGE_TEST_PORT || 5184);
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && node e2e/serve.mjs', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, timeout: 60000 },
});
