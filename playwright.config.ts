import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites with different needs:
 *   - `parity` runs the simulation in a bare page; it needs no server.
 *   - `app` drives the built game, so it needs the preview server running.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'parity',
      testMatch: /parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'app',
      testMatch: /(app|tutorial|leaderboard)\.spec\.ts/,
      // A mid-range Android viewport, because that is the device the design targets.
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run build --workspace=@fuse/game && npm run preview --workspace=@fuse/game',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
