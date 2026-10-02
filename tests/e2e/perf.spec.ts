import { expect, test } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GEN, openFilters } from './helpers';

const LARGE = join(GEN, 'large', 'Streaming_History_Audio_large_0.json');

test('large import runs in the worker without freezing the UI', async ({ page }) => {
  test.skip(!existsSync(LARGE), 'Run `npm run fixtures` to generate the large fixture');
  test.setTimeout(180_000);
  await page.goto('/');
  await page.evaluate(() => {
    const w = window as unknown as { __maxGap: number; __last: number };
    w.__maxGap = 0;
    w.__last = performance.now();
    setInterval(() => {
      const now = performance.now();
      w.__maxGap = Math.max(w.__maxGap, now - w.__last);
      w.__last = now;
    }, 16);
  });
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles(LARGE);
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByTestId('hero-hours')).toBeVisible({ timeout: 150_000 });
  const importMs = Date.now() - t0;
  await expect(page.locator('path[data-series]').first()).toBeVisible();
  const t1 = Date.now();
  await openFilters(page);
  await page.getByRole('radio', { name: 'Month' }).click();
  await expect(page.locator('.chart-area.stale')).toHaveCount(0);
  const reaggMs = Date.now() - t1;
  const maxGap = await page.evaluate(() => (window as unknown as { __maxGap: number }).__maxGap);
  const mb = (statSync(LARGE).size / 1e6).toFixed(0);
  test.info().annotations.push({ type: 'perf', description: `${mb} MB file: import ${importMs} ms, re-aggregate (month) ${reaggMs} ms, max main-thread timer gap ${maxGap.toFixed(0)} ms` });
  console.log(`PERF ${mb} MB: import ${importMs} ms, month re-aggregate ${reaggMs} ms, max main-thread gap ${maxGap.toFixed(0)} ms`);
  expect(maxGap).toBeLessThan(250);
});
