import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEN, uploadZip, chartOption, exportAs, openOptions, openDataQuality, goSection, openSettings, openFilters } from './helpers';

test('defaults: top 12, distinct colours; Other is never drawn and has no option', async ({ page }) => {
  await uploadZip(page, { top: null });
  await expect(page.getByTestId('chart-title').first()).toContainText('top 12 artists', { ignoreCase: true });
  await expect(page.locator('path[data-series="Other artists"]')).toHaveCount(0);
  await expect(page.locator('[data-zero-line]')).toHaveCount(0);
  await expect(page.locator('.legend-item', { hasText: 'Other artists' })).toContainText('not drawn');
  await expect(page.getByTestId('other-note')).toContainText('Not drawn: 1 other artist');
  await openOptions(page);
  for (const name of ['Below axis', 'Hide', 'Band', 'Outline']) await expect(page.getByRole('radio', { name })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Flow' }).click();
  await expect(page.locator('rect[data-node="Other artists"]')).toHaveCount(0);
  await expect(page.locator('[data-zero-line]')).toHaveCount(0);
  // 12 distinct colours, no two displayed artists share one
  await page.getByRole('radio', { name: 'Stream' }).click();
  const fills = await page.locator('path[data-series]').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(fills).toHaveLength(12);
  expect(new Set(fills).size).toBe(fills.length);
});

test('Top by: charts and lists pick the top items by time or by times played', async ({ page }) => {
  await uploadZip(page, { top: 3 });
  await expect(page.locator('.chart-sub')).toContainText('top by listening time');
  await page.getByRole('radio', { name: 'Times played' }).click();
  await expect(page.locator('.chart-sub')).toContainText('top by times played');
  await page.getByRole('tab', { name: 'Top artists' }).click();
  await expect(page.getByTestId('board-row').first()).toContainText('Artist B');
  await expect(page.locator('.board-head .on')).toHaveText('Times played');
});

test('albums count album listens, not summed track plays', async ({ page }) => {
  await uploadZip(page, { section: 'Albums', top: null });
  await expect(page.getByRole('radio', { name: 'Album listens' })).toHaveCount(1);
  const first = page.getByTestId('board-row').first();
  await expect(first).toContainText('Artist B Album');
  // Synthetic plays are hours apart, so no sitting covers 3 tracks: no album listens, but track plays are shown.
  await expect(first.getByTestId('board-plays')).toHaveText('–');
  await expect(first.getByTestId('board-track-plays')).toContainText('740 track plays');
  await first.click();
  await expect(page.getByTestId('album-listens')).toHaveText('–');
});

test('theme switch: light and dark override the system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await uploadZip(page);
  await openSettings(page);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(13, 13, 13)');
  await expect(page.locator('svg.chart-svg > rect').first()).toHaveAttribute('fill', '#1a1a19');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('radio', { name: 'Light' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 245, 241)');
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 13, 13)');
});

test('Eras: one lane per artist, sorted by peak, with peak labels', async ({ page }) => {
  await uploadZip(page);
  await page.getByRole('tab', { name: 'Eras' }).click();
  const lanes = page.locator('g[data-lane]');
  await expect(lanes).toHaveCount(13); // all 13 artists fit in 20 lanes
  const order = await lanes.evaluateAll((els) => els.map((e) => e.getAttribute('data-lane')));
  // Artist A peaks in 2019 so comes before Artist B (peak 2020 Q4+); Sigur variants peak 2021 Q1.
  expect(order.indexOf('Artist A')).toBeLessThan(order.indexOf('Artist B'));
  expect(order.indexOf('Artist B')).toBeLessThan(order.indexOf('Sigur Rós'));
  await expect(page.locator('g[data-lane="Artist B"] text').filter({ hasText: '2020 Q4' })).toHaveCount(1);
  await openOptions(page);
  await page.getByLabel('Number of lanes').selectOption('10');
  await expect(lanes).toHaveCount(10);
  const hit = page.getByTestId('eras-hit');
  const box = (await hit.boundingBox())!;
  await hit.hover({ position: { x: box.width * 0.05, y: 15 } });
  await expect(page.locator('.tooltip')).toContainText('Peak');
});

test('Rankings: yearly by default, ranks among all artists, lines stop where absent', async ({ page }) => {
  await uploadZip(page);
  await page.getByRole('tab', { name: 'Rankings' }).click();
  await expect(page.locator('.chart-sub')).toContainText('Rank each year');
  const a = page.locator('g[data-bump="Artist A"] circle');
  await expect(a).toHaveCount(3); // 2019, 2020, 2022; absent all of 2021
  await expect(page.locator('g[data-bump="Artist A"] circle[data-period="2019"]')).toHaveAttribute('data-rank', '1');
  await expect(page.locator('g[data-bump="Artist B"] circle[data-period="2021"]')).toHaveAttribute('data-rank', '1');
  await page.locator('g[data-bump="Artist B"] circle[data-period="2021"]').hover();
  await expect(page.locator('.tooltip')).toContainText('#1 of');
  // Quarterly ranks on request.
  await chartOption(page, 'Quarter');
  await expect(page.locator('g[data-bump="Artist A"] circle')).toHaveCount(10);
  await expect(page.locator('g[data-bump="Artist A"] circle[data-period="2019 Q1"]')).toHaveAttribute('data-rank', '1');
});

test('Listening clock: totals match, offset is labelled', async ({ page }) => {
  await uploadZip(page, { section: 'Insights', top: null });
  await expect(page.locator('rect[data-cell]')).toHaveCount(168);
  const total = await page.locator('rect[data-cell]').evaluateAll((els) => els.reduce((s, e) => s + Number(e.getAttribute('data-ms')), 0));
  expect(total).toBe(2428 * 180_000 + 30_000);
  await openOptions(page, page.getByTestId('clock-explore'));
  await page.getByLabel('Time offset').selectOption('-5');
  await expect(page.getByTestId('clock-explore').locator('.chart-sub')).toContainText('UTC−5');
  await expect(page.getByTestId('clock-explore').locator('.chart-note')).toContainText('no daylight saving');
});

test('stray early plays: default range starts at regular listening and says so', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(join(GEN, 'stray', 'Streaming_History_Audio_2016-2020_0.json'));
  await expect(page.getByTestId('hero-hours')).toBeVisible();
  await openDataQuality(page);
  await expect(page.getByTestId('range-note')).toContainText('earliest 3 plays (from 2016-03-14)');
  await expect(page.getByTestId('range-note')).toContainText('Jan 2019');
  await goSection(page, 'Overview');
  await openFilters(page);
  await expect(page.getByLabel('Range start')).toHaveValue(/.+/);
  await expect(page.getByLabel('Range start').locator('option:checked')).toHaveText('2019 Q1');
  await expect(page.getByTestId('filter-impact')).toContainText('3 plays');
  await expect(page.getByTestId('filter-impact')).toContainText('outside the date range');
  await page.getByRole('button', { name: 'Include them' }).click(); // the filter bar's link
  await expect(page.getByLabel('Range start').locator('option:checked')).toHaveText('2016 Q1');
  await goSection(page, 'Data');
  await page.getByText('Import details').click();
  await expect(page.locator('.mini-table').nth(1)).toContainText('2016-03-14 to');
});

test('exports work for the new views', async ({ page }) => {
  await uploadZip(page);
  for (const [tab, file, text] of [
    ['Eras', 'listening-artist-eras-quarter-hours.svg', 'Artists by era'],
    ['Rankings', 'listening-artist-ranks-year-hours.svg', 'How the top 6 artists ranked'],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click();
    const dl = page.waitForEvent('download');
    await exportAs(page, 'SVG');
    const f = await dl;
    expect(f.suggestedFilename()).toBe(file);
    const svg = readFileSync(await f.path(), 'utf8');
    expect(svg).toContain(text);
    expect(svg).toContain('Actual data coverage');
  }
});

test('story: headline numbers match the charts, highlights and year cards', async ({ page }) => {
  await uploadZip(page, { section: 'Overview', top: null });
  await expect(page.getByTestId('hero-plays')).toHaveText('2,429'); // same plays every chart counts
  await expect(page.getByTestId('overview-explore').getByTestId('filter-impact')).toContainText('2,429 plays');
  await expect(page.getByTestId('hero-hours')).toHaveText('121 hours');
  await expect(page.getByTestId('highlights')).toContainText('Your top artist changed');
  await expect(page.getByTestId('year-card')).toHaveCount(4);
  // Clicking a year focuses every view on it.
  await page.getByTestId('year-card').nth(2).locator('.year-pick').click();
  await expect(page.getByRole('button', { name: '2021', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('year-card')).toHaveCount(0); // a single year needs no year row
  await expect(page.getByTestId('hero-plays')).toHaveText('694'); // 2021 only
  await page.getByRole('button', { name: 'All years' }).click();
  await expect(page.getByTestId('year-card')).toHaveCount(4);
});

test('search opens artists, albums, songs from the header', async ({ page }) => {
  await uploadZip(page, { section: 'Overview', top: null });
  await page.getByRole('searchbox', { name: 'Search your library' }).fill('artist b');
  await expect(page.getByTestId('search-results')).toContainText('Artist B');
  await page.keyboard.press('Enter');
  await expect(page.locator('#entity-title')).toHaveText('Artist B');
  await expect(page.getByTestId('entity-history')).toContainText('Discovered');
  await expect(page.getByTestId('entity-history')).toContainText('Years played');
});

test('insights section: calendar, discovery, skips, sessions', async ({ page }) => {
  await uploadZip(page, { section: 'Overview', top: null });
  await goSection(page, 'Insights');
  await expect(page.getByTestId('insights')).toBeVisible();
  expect(await page.locator('rect[data-day]').count()).toBeGreaterThan(1400); // 4 years of days
  await expect(page.getByTestId('insights')).toContainText('Discovering new artists');
  await expect(page.getByTestId('insights')).toContainText('Most skipped songs');
  await expect(page.getByTestId('insights')).toContainText('Artist C Song 1');
  await expect(page.getByTestId('insights')).toContainText('Sessions');
  // Visual series
  expect(await page.getByTestId('discovery-card').locator('[data-bar]').count()).toBe(48); // one bar per month, Jan 2019 - Dec 2022
  await expect(page.getByTestId('notable-discoveries')).toContainText('2019');
  await expect(page.getByTestId('notable-discoveries')).toContainText('Artist B');
  await expect(page.getByTestId('artist-skips')).toContainText('Artist C');
  await expect(page.getByTestId('song-binges').locator('li')).toHaveCount(8);
  await expect(page.getByTestId('loyal-rows').locator('[data-heat-row]')).toHaveCount(10);
  await page.getByTestId('notable-discoveries').getByRole('button', { name: 'Artist A' }).click();
  await expect(page.locator('#entity-title')).toHaveText('Artist A');
});

test('listening clock defaults to the browser timezone', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  await uploadZip(page, { section: 'Insights', top: null });
  await expect(page.getByTestId('clock-explore').locator('.chart-sub')).toContainText('your timezone (Europe/Berlin)');
  await ctx.close();
});

test('albums: whole-album view explains its rule and handles none', async ({ page }) => {
  await uploadZip(page, { section: 'Albums', top: null });
  await page.getByRole('tab', { name: 'Whole albums' }).click();
  await expect(page.getByTestId('whole-albums')).toContainText('No album was played front to back');
  await expect(page.getByTestId('whole-total')).toHaveText('0');
  await expect(page.getByTestId('whole-albums')).toContainText('at least 80% of those tracks');
});

test('Patterns: eras, tastes, co-listening map and lifecycles; artist panel shows who you play alongside', async ({ page }) => {
  await uploadZip(page, { top: null, section: 'Overview' });
  // Story shows the era strip, which links to Patterns.
  await expect(page.getByTestId('story-eras')).toBeVisible();
  await page.getByTestId('story-eras').getByRole('button', { name: 'Explore patterns' }).click();
  await expect(page.getByRole('navigation', { name: 'Patterns' })).toBeVisible();
  await expect(page.getByTestId('era-card')).toHaveCount(3);
  await expect(page.getByTestId('era-card').first()).toContainText('Artist A');

  // Tastes: one band per taste (other artists are not drawn); the count can be changed.
  await expect(page.getByTestId('taste-card')).toHaveCount(6);
  await page.getByLabel('Number of tastes').selectOption('3');
  await expect(page.getByTestId('taste-card')).toHaveCount(3);
  await expect(page.getByTestId('tastes').locator('path[data-series]')).toHaveCount(3);

  // Map: every top artist is a node; clicking one selects it and lists its partners, from
  // where the artist panel opens. Search finds artists; groups can be focused.
  await expect(page.locator('[data-testid=colisten-map] circle')).toHaveCount(11);
  await page.locator('[data-testid=colisten-map] circle[data-artist="Artist B"]').click();
  await expect(page.getByTestId('map-selection')).toContainText('Played most often with');
  await expect(page.getByTestId('map-selection').locator('.partner-list li')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await page.getByLabel('Find an artist on the map').fill('Artist C');
  await expect(page.getByTestId('map-selection').getByRole('heading', { level: 3 })).toHaveText('Artist C');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await page.getByRole('radio', { name: 'Discovered' }).click();
  await expect(page.getByTestId('colisten-explorer')).toContainText('First played');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(500); // view animation
  await page.locator('[data-testid=colisten-map] circle[data-artist="Artist B"]').click();
  await page.getByRole('button', { name: 'Open artist details' }).click();
  await expect(page.getByTestId('entity-panel')).toContainText('Artist B');
  await expect(page.getByTestId('alongside')).toContainText('sessions together');
  await expect(page.getByTestId('entity-lifecycle')).toContainText('Slow burn');
  await page.getByRole('button', { name: 'Close details' }).click();

  // Lifecycles and the survival curve.
  await expect(page.getByTestId('life-card').getByRole('tab', { name: /Evergreen 8/ })).toBeVisible();
  await expect(page.getByTestId('life-rows').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('survival')).toContainText('Kaplan-Meier');
});
