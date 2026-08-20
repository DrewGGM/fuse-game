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
  // reuseExistingServer is off even locally.
  //
  // It is meant to save a rebuild, and twice it silently served the *other*
  // repository's preview instead — once because both used 4173, and again after
  // a killed run left a zombie listening. A suite that tests whatever happens to
  // be on a port is not testing anything. The few seconds a rebuild costs are
  // cheaper than the half hour of debugging a wrong build produces.
  webServer: {
    // FUSE_API_BASE points at a port nothing listens on, so the suite cannot
    // reach the real API even by accident.
    //
    // It could, until the API went live: the tests assumed "no server" because
    // there happened not to be one, and the moment there was, they started
    // submitting fabricated runs to the production leaderboard. A test that
    // depends on production being down is not a test.
    command:
      'cross-env FUSE_API_BASE=http://127.0.0.1:9 npm run build --workspace=@fuse/game && npm run preview --workspace=@fuse/game',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
