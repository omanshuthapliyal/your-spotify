import { defineConfig, devices } from '@playwright/test';

// Builds with the sample genre CSV baked in, to test the built-in mapping path.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['**/baked.spec.ts', '**/baked-shots.spec.ts'],
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4175', ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } },
  webServer: {
    command: 'npx vite build -c vite.report.config.ts && BAKED_GENRES_FILE=fixtures/genres_sample.csv BAKED_TREE_FILE=fixtures/genre-tree.sample.json BAKED_ARTIST_INFO_FILE=fixtures/artist-info.sample.csv BAKED_ALBUM_YEARS_FILE=fixtures/album-years.sample.csv BAKED_ART_FILE=fixtures/art-index.sample.json npx vite build --outDir dist-baked-test && npx vite preview --outDir dist-baked-test --port 4175 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
