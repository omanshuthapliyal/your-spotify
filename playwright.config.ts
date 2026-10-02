import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: ['**/baked.spec.ts', '**/baked-shots.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 900 },
  },
  webServer: {
    // Tests run against the production build so the CSP is in force.
    // Separate output folder and no baked genres, so tests never touch your personal build.
    command: 'npx vite build -c vite.report.config.ts && NO_BAKED_GENRES=1 npx vite build --outDir dist-test && npx vite preview --outDir dist-test --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
