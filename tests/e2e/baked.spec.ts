import { expect, test } from '@playwright/test';
import { goSection, uploadZip } from './helpers';

test('a baked-in genre mapping, tree and years apply automatically after import', async ({ page }) => {
  await uploadZip(page, { top: null, section: 'Overview' });
  await expect(page.getByTestId('top-genre')).toContainText('Indie Rock');
  await goSection(page, 'Data');
  await expect(page.getByTestId('genre-status')).toContainText('built in: genres_sample.csv');
  await expect(page.getByTestId('genre-status')).toContainText('5 of 13 artists');
  await expect(page.getByTestId('sources')).toContainText('Album covers 1 albums');
  await goSection(page, 'Genres');
  // Sample tree: Indie Rock sits under Rock; Soul under Rhythm And Blues.
  await expect(page.locator('[data-node="g:rock"]')).toHaveCount(1);
  await page.locator('[data-node="g:rock"]').click();
  await expect(page.getByTestId('branch-hours')).toHaveText('42.0 h');
  await page.getByRole('tab', { name: 'Decades' }).click();
  await expect(page.getByTestId('decades-card')).toContainText('Rock: listening by album release decade');
  // Decades: by album release on the Albums page; entity drawer shows MusicBrainz-derived years.
  await goSection(page, 'Albums');
  await expect(page.getByTestId('decades-card').locator('[data-decade="1990s"]')).toHaveCount(1);
  await page.getByRole('tab', { name: /^Top / }).click();
  await page.getByTestId('board-row').filter({ hasText: 'Artist A Album' }).click();
  await expect(page.getByTestId('entity-panel')).toContainText('Released 1994');
  // Covers: album, its songs, and its artist use the baked cover; albums without one get a placeholder.
  await expect(page.getByTestId('entity-panel').locator('img.cover').first()).toHaveAttribute('src', /^data:image\/svg/);
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('board-row').filter({ hasText: 'Artist A Album' }).locator('img.cover')).toHaveCount(1);
  await expect(page.getByTestId('board-row').filter({ hasText: 'Artist B Album' }).locator('.cover-empty')).toHaveCount(1);
  await goSection(page, 'Tracks');
  await expect(page.getByTestId('board-row').filter({ hasText: 'Artist A Song 1' }).locator('img.cover')).toHaveCount(1);
});

test('genre streams are embeddable: top level from Explore > Genres, and any branch', async ({ page, context }) => {
  await uploadZip(page, { top: null, section: 'Genres' });
  const explore = page.getByTestId('genre-explore');
  await explore.getByRole('button', { name: 'Embed' }).click();
  await expect(page.getByLabel('Plot to export')).toHaveValue('genres-timeline');
  await expect(page.getByTestId('share-branch')).toHaveCount(0);
  const dlTop = page.waitForEvent('download');
  await page.getByTestId('create-report').click();
  const top = await dlTop;
  const { copyFileSync: cp0, mkdirSync: mk0 } = await import('node:fs');
  const { resolve: res0 } = await import('node:path');
  mk0('screenshots', { recursive: true });
  cp0(await top.path(), 'screenshots/sample-genres-top.html');
  await page.getByRole('button', { name: 'Close' }).click();

  // The embedded top level drills down: click a band (or its legend entry) for its sub-genres.
  const v = await context.newPage();
  const errors: string[] = [];
  v.on('pageerror', (e) => errors.push(e.message));
  await v.goto(`file://${res0('screenshots/sample-genres-top.html')}#plot=genres-timeline&embed`);
  await expect(v.getByRole('heading', { name: 'Genre branches over time' })).toBeVisible();
  await expect(v.getByRole('navigation', { name: 'Genre level' })).toHaveText('All genres');
  await v.locator('.legend').getByRole('button', { name: /^Rock\b/ }).click();
  await expect(v.getByRole('heading', { name: 'Rock: sub-genres over time' })).toBeVisible();
  await expect(v.getByRole('navigation', { name: 'Genre level' })).toHaveText('All genres › Rock');
  await expect(v.locator('path[data-series="Indie Rock"]')).toHaveCount(1);
  await v.getByRole('button', { name: '← Back' }).click();
  await expect(v.getByRole('heading', { name: 'Genre branches over time' })).toBeVisible();
  // Clicking the band itself (at its on-chart label) drills down too.
  const lbl = (await v.locator('svg text', { hasText: /^Rock$/ }).first().boundingBox())!;
  const hit = (await v.getByTestId('stack-hit').boundingBox())!;
  await v.getByTestId('stack-hit').click({ position: { x: lbl.x + lbl.width / 2 - hit.x, y: lbl.y + lbl.height / 2 - hit.y } });
  await expect(v.getByRole('heading', { name: 'Rock: sub-genres over time' })).toBeVisible();
  await v.getByRole('navigation', { name: 'Genre level' }).getByRole('button', { name: 'All genres' }).click();
  await expect(v.getByRole('heading', { name: 'Genre branches over time' })).toBeVisible();
  expect(errors).toEqual([]);
  await v.close();

  // Inside a branch: its sub-genres over time.
  await page.locator('[data-node="g:rock"]').click();
  await page.getByRole('tab', { name: 'Sub-genres' }).click();
  await explore.getByRole('button', { name: 'Embed' }).click();
  await expect(page.getByTestId('share-branch')).toContainText('Rock');
  const dl = page.waitForEvent('download');
  await page.getByTestId('create-report').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('genres-rock.html');
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(await file.path(), 'utf8');
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  expect(data.plot).toBe('genres-timeline');
  expect(data.genres.branch.label).toBe('Rock');
  expect(data.genres.timeline.series.map((s: { label: string }) => s.label)).toContain('Indie Rock');
  expect(data.genres.list).toBeUndefined();
  const { copyFileSync, mkdirSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  mkdirSync('screenshots', { recursive: true });
  copyFileSync(await file.path(), 'screenshots/sample-genres-rock.html');
  const viewer = await context.newPage();
  await viewer.goto(`file://${resolve('screenshots/sample-genres-rock.html')}#plot=genres-timeline&embed`);
  await expect(viewer.getByRole('heading', { name: 'Rock: sub-genres over time' })).toBeVisible();
  await expect(viewer.locator('path[data-series="Indie Rock"]')).toHaveCount(1);
});
