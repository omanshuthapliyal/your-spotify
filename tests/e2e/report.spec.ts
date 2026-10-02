import { expect, test } from '@playwright/test';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAKE_SENSITIVE } from '../../fixtures/synthetic';
import { uploadZip } from './helpers';

test('share report: self-contained, interactive, private, embeddable', async ({ page, context }) => {
  await uploadZip(page, { section: 'Overview', top: null });
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByTestId('share-dialog')).toBeVisible();
  await page.getByLabel('Report title').fill('Test listening report');
  await page.getByLabel('Your name').fill('Tester');
  await page.getByLabel('Songs').uncheck();
  const dl = page.waitForEvent('download');
  await page.getByTestId('create-report').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('test-listening-report.html');
  await expect(page.getByTestId('embed-snippet')).toContainText('#story&embed');
  const path = await file.path();
  const html = readFileSync(path, 'utf8');
  mkdirSync('screenshots', { recursive: true });
  copyFileSync(path, 'screenshots/sample-report.html');
  const htmlPath = resolve('screenshots/sample-report.html'); // downloads have no extension; browsers need .html

  // Static checks on the file itself.
  for (const v of Object.values(FAKE_SENSITIVE)) expect(html).not.toContain(v);
  expect(html).toContain("connect-src 'none'");
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3\.org|react\.dev)/);
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  expect(data.songs).toBeUndefined();
  expect(data.habits.days).toEqual([]); // routine off by default

  // Open the report on its own: no network at all.
  const viewer = await context.newPage();
  const requests: string[] = [];
  viewer.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  const errors: string[] = [];
  viewer.on('pageerror', (e) => errors.push(e.message));
  await viewer.goto(`file://${htmlPath}`);
  await expect(viewer.getByRole('heading', { name: 'Test listening report' })).toBeVisible();
  await expect(viewer.getByText('Tester ·')).toBeVisible();
  await expect(viewer.getByTestId('hero-plays')).toHaveText('2,429');
  const tabs = await viewer.getByRole('navigation', { name: 'Report sections' }).getByRole('button').allTextContents();
  expect(tabs).toEqual(['Story', 'Artists', 'Albums', 'Habits', 'Patterns']);
  await viewer.getByRole('navigation', { name: 'Report sections' }).getByRole('button', { name: 'Artists' }).click();
  await expect(viewer.getByTestId('board-row').first()).toContainText('Artist B');
  await viewer.getByRole('tab', { name: 'Timeline' }).click();
  await expect(viewer.locator('path[data-series]').first()).toBeVisible();
  const hit = viewer.getByTestId('stack-hit');
  const box = (await hit.boundingBox())!;
  await hit.hover({ position: { x: box.width * 0.05, y: box.height * 0.6 } });
  await expect(viewer.locator('.tooltip')).toBeVisible(); // interactive
  await viewer.getByRole('tab', { name: 'Eras' }).click();
  await expect(viewer.locator('g[data-lane]').first()).toBeVisible();
  await viewer.screenshot({ path: 'screenshots/report-artists.png', fullPage: true });

  // Embed mode for one section.
  await viewer.goto(`file://${htmlPath}#albums&embed`);
  await expect(viewer.getByRole('navigation', { name: 'Report sections' })).toHaveCount(0);
  await expect(viewer.getByRole('tab', { name: 'Whole albums' })).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
