import { test } from '@playwright/test';
import { goSection, uploadZip } from './helpers';

// Screenshots for manual inspection (not pixel-diffed), plus a no-horizontal-scroll guard.
for (const [name, viewport] of [['desktop', { width: 1360, height: 900 }], ['narrow', { width: 390, height: 844 }]] as const) {
  test(`screenshot ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.screenshot({ path: `screenshots/${name}-01-import.png`, fullPage: true });
    await uploadZip(page, { top: null, section: 'Overview' });
    const noHScroll = async (where: string) => {
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`Horizontal page scroll at ${name} / ${where}`);
    };
    await page.waitForTimeout(300);
    await page.screenshot({ path: `screenshots/${name}-02-overview.png`, fullPage: true });
    await noHScroll('overview');
    await goSection(page, 'Artists');
    for (const tab of ['Timeline', 'Top artists', 'Eras', 'Rankings']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(250);
      await page.locator('.chart-card').first().screenshot({ path: `screenshots/${name}-03-artists-${tab.toLowerCase().replace(' ', '-')}.png` });
      await noHScroll(`artists ${tab}`);
    }
    for (const s of ['Albums', 'Tracks', 'Genres'] as const) {
      await goSection(page, s);
      await page.waitForTimeout(250);
      await noHScroll(s);
    }
  });
}

test('screenshot dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await uploadZip(page, { top: null });
  await page.locator('.chart-card').first().screenshot({ path: 'screenshots/dark-artists.png' });
  await goSection(page, 'Overview');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'screenshots/dark-overview.png', fullPage: true });
});
