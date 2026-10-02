import { expect, test } from '@playwright/test';
import { EXT, GEN, uploadZip, toggleTable, setMinPlay, openDataQuality, goSection } from './helpers';
import { join } from 'node:path';

test.describe('import -> audit -> chart -> controls', () => {
  test('shows an audit that reconciles with the fixture', async ({ page }) => {
    await uploadZip(page, { section: 'Overview', top: null });
    await openDataQuality(page);
    // 2429 accepted at 30 s + 31 short plays = 2460 valid music plays before the duration filter
    await expect(page.getByTestId('stat-plays')).toHaveText('2,460');
    await expect(page.getByTestId('stat-range')).toHaveText('2019-01-02 to 2022-12-20');
    await page.getByText('Import details').click();
    const row = (r: string) => page.locator(`[data-testid=audit-excluded] tr[data-reason=${r}] td`).first();
    await expect(row('podcast')).toHaveText('11');
    await expect(row('audiobook')).toHaveText('2');
    await expect(row('missingArtist')).toHaveText('1');
    await expect(row('unidentified')).toHaveText('1');
    await expect(row('invalidDate')).toHaveText('2');
    await expect(row('malformed')).toHaveText('4');
    await expect(row('crossFileDuplicate')).toHaveText('1');
    await expect(page.getByText('Sigur Ros · Sigur Rós')).toBeVisible();
    await expect(page.getByText('Ignored')).toBeVisible(); // the ReadMe PDF inside the ZIP
    await goSection(page, 'Overview');
    await expect(page.getByTestId('filter-impact')).toContainText('2,429 plays');
    await expect(page.getByTestId('filter-impact')).toContainText('31 plays');
  });

  test('renders the stacked timeline with eras, Other, and a marked empty period', async ({ page }) => {
    await uploadZip(page);
    const series = await page.locator('path[data-series]').evaluateAll((els) => els.map((e) => e.getAttribute('data-series')));
    expect(series).toEqual(['Artist B', 'Artist A', 'Artist C', 'Artist D', 'Artist E', 'Artist F', 'Other artists']);
    await expect(page.locator('[data-empty-period="2020 Q3"]')).toHaveCount(1);
    // Tooltip on hover shows exact values
    const hit = page.getByTestId('stack-hit');
    const box = (await hit.boundingBox())!;
    await hit.hover({ position: { x: box.width * (0.5 / 16), y: box.height - 5 } }); // Band mode: stack starts at the bottom
    await expect(page.locator('.tooltip')).toContainText('2019 Q1');
    await expect(page.locator('.tooltip')).toContainText('4.0 h');
    await hit.hover({ position: { x: box.width * (6.5 / 16), y: 20 } });
    await expect(page.locator('.tooltip')).toContainText('No music plays recorded');
  });

  test('controls change the chart and filter accounting', async ({ page }) => {
    await uploadZip(page);
    await page.getByRole('radio', { name: 'Share' }).click();
    await expect(page.locator('svg.chart-svg text').filter({ hasText: '100%' })).toHaveCount(1);
    await page.getByRole('radio', { name: 'Month' }).click();
    await expect(page.locator('[data-empty-period]')).toHaveCount(3);
    await page.getByRole('radio', { name: 'Year' }).click();
    await expect(page.locator('[data-empty-period]')).toHaveCount(0);
    await page.getByLabel('Top artists').selectOption('2');
    await expect(page.locator('path[data-series]')).toHaveCount(3); // 2 above the axis + Other below
    await expect(page.getByTestId('other-note')).toContainText('Below the line: 11 other artists');
    await setMinPlay(page, 0);
    await expect(page.getByTestId('filter-impact')).toContainText('2,460 plays');
    await page.getByLabel('Range start').selectOption({ label: '2021' });
    await page.getByLabel('Range end').selectOption({ label: '2021' });
    await expect(page.getByTestId('filter-impact')).toContainText('694 plays');
    await expect(page.getByTestId('filter-impact')).toContainText('outside the date range');
    // Legend pin highlights a series
    await page.locator('.legend-item', { hasText: 'Artist B' }).click();
    await expect(page.locator('.legend-item', { hasText: 'Artist B' })).toHaveAttribute('aria-pressed', 'true');
    // Table view
    await toggleTable(page);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
  });

  test('click opens details with top tracks, keyboard navigation works', async ({ page }) => {
    await uploadZip(page);
    const hit = page.getByTestId('stack-hit');
    const box = (await hit.boundingBox())!;
    // The bottom of the stack sits just above the zero line (Other is below it).
    const zeroY = Number(await page.locator('[data-zero-line] line').getAttribute('y1'));
    await hit.click({ position: { x: box.width * (1.5 / 16), y: zeroY - 5 } });
    // Clicking an artist's band opens that artist's detail drawer.
    await expect(page.locator('#entity-title')).toHaveText('Artist B');
    await expect(page.getByTestId('entity-panel').locator('.rank-list').first().locator('li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.mouse.move(0, 0);
    await page.locator('svg.chart-svg').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.tooltip')).toContainText('2019 Q1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#details-title')).toHaveText('All listening');
  });
});

test.describe('import errors and duplicates', () => {
  test('one-year export gets a specific message', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(join(GEN, 'StreamingHistory_music_0.json'));
    await expect(page.getByRole('alert')).toContainText('one-year');
  });
  test('unsupported and empty files are rejected clearly', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles([join(GEN, 'not_streaming_history.json'), join(GEN, 'empty.json')]);
    await expect(page.getByRole('alert')).toContainText('No Spotify Extended Streaming History files');
    await expect(page.getByRole('alert')).toContainText('no records');
  });
  test('uploading the ZIP plus a loose copy does not double count', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles([
      join(GEN, 'synthetic_extended_history.zip'),
      EXT('Streaming_History_Audio_2019-2020_0.json'),
    ]);
    await expect(page.getByTestId('hero-hours')).toBeVisible();
    await openDataQuality(page);
    await expect(page.getByTestId('stat-plays')).toHaveText('2,460');
    await page.getByText('Import details').click();
    await expect(page.locator('.chip-duplicate')).toHaveCount(1);
  });
  test('multiple loose JSON files work', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles([
      EXT('Streaming_History_Audio_2019-2020_0.json'),
      EXT('Streaming_History_Audio_2021-2022_1.json'),
      EXT('Streaming_History_Video_2019-2022.json'),
    ]);
    await expect(page.getByTestId('hero-hours')).toBeVisible();
    await openDataQuality(page);
    await expect(page.getByTestId('stat-plays')).toHaveText('2,460');
  });
});
