import { test } from '@playwright/test';
import { goSection, uploadZip } from './helpers';
// Manual-inspection screenshots of every section (baked sample genres, tree and years).
test('section screenshots', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await uploadZip(page, { top: null, section: 'Overview' });
  const shot = async (n: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `screenshots/s-${n}.png`, fullPage: true }); };
  await shot('overview');
  for (const s of ['Artists', 'Albums', 'Tracks'] as const) { await goSection(page, s); await shot(s.toLowerCase()); }
  await goSection(page, 'Genres');
  await shot('genres');
  await page.locator('[data-node="g:rock"]').first().click();
  await page.getByRole('tab', { name: 'Artists', exact: true }).click();
  await shot('genre-rock-artists');
  await goSection(page, 'Tracks');
  await page.getByTestId('board-row').first().click();
  await page.getByTestId('entity-panel').getByRole('button', { name: /Artist B$/ }).first().click().catch(() => undefined);
  await shot('entity');
  if (errors.length) throw new Error(errors.join('\n'));
});
