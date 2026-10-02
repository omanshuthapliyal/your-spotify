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
