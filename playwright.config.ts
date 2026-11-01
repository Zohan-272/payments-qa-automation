import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'ui', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
  ],
  // Starts the bundled mock payments server, so the suite needs no external services.
  webServer: {
    command: 'npm run start:mock',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !!process.env.REUSE_SERVER,
    timeout: 30_000,
    env: { MOCK_PORT: String(PORT) },
  },
});
