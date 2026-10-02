import { expect, test } from '@playwright/test';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { goSection, uploadZip, exportAs } from './helpers';

const CSV = join(import.meta.dirname, '..', '..', 'fixtures', 'genres_sample.csv');

test('genres: set-up from a user CSV, tree, branch deep-dive, Unclassified kept', async ({ page }) => {
  await uploadZip(page);
  await goSection(page, 'Genres');
  // Before a mapping exists the section shows how to add one.
  await expect(page.locator('details#genres')).toHaveAttribute('open', '');
  await expect(page.locator('details#genres')).toContainText('npm run genres -- --zip');
  await page.getByTestId('genre-input').setInputFiles(CSV);
  await expect(page.getByRole('complementary', { name: 'Genre tree' })).toBeVisible();
  // Root branch view: top-level branches plus Unclassified, totals = all listening.
  const series = await page.getByTestId('genre-explore').locator('path[data-series]').evaluateAll((els) => els.map((e) => e.getAttribute('data-series')));
  expect(series).toContain('Unclassified');
  expect(series).toContain('Indie Rock');
  await expect(page.getByTestId('genre-explore').getByTestId('filter-impact')).toContainText('2,429 plays');
  // Drill into a branch, then look at its artists.
  await page.locator('[data-node="g:indie rock"]').first().click();
  await expect(page.getByTestId('branch-head')).toContainText('Indie Rock');
  await expect(page.getByTestId('branch-hours')).toHaveText('42.0 h');
  await page.getByRole('tab', { name: 'Artists', exact: true }).click();
  // Opens on the ranked list of the branch's artists.
  await expect(page.getByTestId('genre-explore').getByTestId('board-row')).toHaveCount(2);
  await expect(page.getByTestId('genre-explore').getByTestId('board-row').first()).toContainText('Artist A');
  await page.getByTestId('genre-explore').getByTestId('board-row').first().click();
  await expect(page.locator('#entity-title')).toHaveText('Artist A');
});

test('genre template is generated locally from the export', async ({ page }) => {
  await uploadZip(page);
  await goSection(page, 'Genres');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download template/ }).click();
  const text = readFileSync(await (await dl).path(), 'utf8');
  expect(text.split('\n').slice(0, 3)).toEqual(['artist,genre', 'Artist B,', 'Artist A,']);
});

test('SVG and PNG exports match the displayed chart and carry labels', async ({ page }) => {
  mkdirSync('screenshots', { recursive: true });
  await uploadZip(page);
  const pathsOnScreen = await page.locator('svg.chart-svg path[data-series]').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
  let dl = page.waitForEvent('download');
  await exportAs(page, 'SVG');
  let file = await dl;
  expect(file.suggestedFilename()).toBe('listening-artist-timeline-quarter-hours.svg');
  const svg = readFileSync(await file.path(), 'utf8');
  copyFileSync(await file.path(), 'screenshots/export-timeline.svg');
  for (const d of pathsOnScreen) expect(svg).toContain(`d="${d}"`);
  expect(svg).toContain('My top 6 artists over time');
  expect(svg).toContain('Listening hours per quarter · top by listening time · 2019 Q1 – 2022 Q4 (UTC)');
  expect(svg).toContain('Filters: plays of at least 30 s');
  expect(svg).toContain('Actual data coverage: 2019-01-02 to 2022-12-20 UTC');
  expect(svg).not.toContain('SYNTHETIC DEMO DATA'); // real upload, not the demo
  expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // no external references

  dl = page.waitForEvent('download');
  await exportAs(page, 'PNG');
  file = await dl;
  const png = readFileSync(await file.path());
  copyFileSync(await file.path(), 'screenshots/export-timeline.png');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const w = png.readUInt32BE(16);
  const svgW = Number(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="(\d+(?:\.\d+)?)"/.exec(svg)![1]);
  expect(w).toBe(Math.round(svgW * 2));

  await page.getByRole('radio', { name: 'Flow' }).click();
  dl = page.waitForEvent('download');
  await exportAs(page, 'PNG');
  file = await dl;
  copyFileSync(await file.path(), 'screenshots/export-flow.png');
  expect(file.suggestedFilename()).toBe('listening-artist-flow-quarter-hours.png');
});
