import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Away from the ports of `npm run demo` (3100 and 3101), so both can run at once.
const port = 3200;
export const ADMIN_PASSWORD = 'e2e-only-password';

// The tests share one database and tell one story each, so they run one at a time, in the Chrome already installed.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  outputDir: join(import.meta.dirname, '.results'),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
  },
  // One sign-in as staff, kept for every test that works in the back office; the tests of the sign-in itself start signed out.
  projects: [
    { name: 'sign-in', testMatch: /auth\.setup\.ts/ },
    {
      name: 'app',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['sign-in'],
      use: { storageState: join(import.meta.dirname, '.auth', 'staff.json') },
    },
  ],
  webServer: {
    command: 'node --import tsx e2e/serve.ts',
    cwd: join(import.meta.dirname, '..'),
    url: `http://127.0.0.1:${port}/`,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    env: {
      WEB_PORT: String(port),
      API_PORT: String(port + 1),
      NEXT_DIST_DIR: '.next-e2e',
      // The offline embedder: the same scores on every machine, with or without the downloaded model.
      EMBEDDER: 'lexical',
      // Names by cue rules: the same answers on every machine, with or without the downloaded model.
      NAMES: 'rules',
      ADMIN_PASSWORD: ADMIN_PASSWORD,
      // The tests are one visitor pressing buttons fast; the limits are for the public demo.
      RATE_LIMIT_PER_MINUTE: '100000',
      AUTH_ATTEMPTS_PER_15_MIN: '100000',
      // Never the demo's bot: a token is long-polled by one process at a time.
      TELEGRAM_BOT_TOKEN: '',
      // The tests start from an empty month; the public demo plays one.
      DEMO_HISTORY_DAYS: '0',
    },
  },
});
