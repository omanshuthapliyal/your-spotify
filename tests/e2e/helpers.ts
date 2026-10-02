import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';

export const GEN = join(import.meta.dirname, '..', '..', 'fixtures', 'generated');
const ZIP = join(GEN, 'synthetic_extended_history.zip');
export const EXT = (name: string) => join(GEN, 'extended', name);

type Section = 'Overview' | 'Artists' | 'Albums' | 'Tracks' | 'Genres' | 'Insights' | 'Data';

/** Navigate by the old section names: Overview = Story, Insights = Habits, library pages under Explore. */
export async function goSection(page: Page, name: Section) {
  const area = (n: string) => page.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: new RegExp(`^${n}`) }).click();
  if (name === 'Overview') return area('Story');
  if (name === 'Insights') return area('Habits');
  if (name === 'Data') return area('Data');
  await area('Explore');
  const sub = name === 'Tracks' ? 'Songs' : name;
  await page.getByRole('navigation', { name: 'Explore' }).getByRole('button', { name: new RegExp(`^${sub}`) }).click();
}

/**
 * Upload the fixture ZIP (lands on Overview, where the audit is), then open a section (Artists by
 * default). Most tests were written for top 6, so that is pinned unless asked otherwise.
 */
export async function uploadZip(page: Page, opts: { top?: number | null; section?: Section } = {}) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(ZIP);
  await expect(page.getByTestId('hero-hours')).toBeVisible();
  await expect(page.locator('path[data-series]').first()).toBeVisible();
  await goSection(page, opts.section ?? 'Artists');
  // Artists opens on its list; most chart tests start from the timeline.
  if ((opts.section ?? 'Artists') === 'Artists') await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  if ((opts.section ?? 'Artists') === 'Insights') await expect(page.getByTestId('insights')).toBeVisible();
  else if ((opts.section ?? 'Artists') !== 'Data') await expect(page.locator('path[data-series], [data-testid=board-row]').first()).toBeVisible();
  const top = opts.top === undefined ? 6 : opts.top;
  if (top !== null) {
    await openFilters(page);
    await page.getByLabel(/^Top (artists|albums|songs|genres)$/).selectOption(String(top));
    await expect(page.getByTestId('chart-title').first()).toContainText(`top ${top} `, { ignoreCase: true });
  }
}

/** Click a control inside a chart's Options menu (opening it first). */
export async function chartOption(page: Page, name: string, card = page.locator('.chart-card').first()) {
  const menu = card.locator('details.menu').filter({ hasText: 'Options' });
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByRole('radio', { name, exact: true }).click();
}

export async function toggleTable(page: Page, card = page.locator('.chart-card').first()) {
  const menu = card.locator('details.menu').filter({ hasText: 'Options' });
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByLabel('Show data table').click();
}

/** Export the chart in the first (or given) card via its Export menu. */
export async function exportAs(page: Page, fmt: 'PNG' | 'SVG', card = page.locator('.chart-card').first()) {
  const menu = card.locator('details.menu').filter({ hasText: 'Export' });
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByRole('button', { name: `Export ${fmt}` }).click();
}

export async function openOptions(page: Page, card = page.locator('.chart-card').first()) {
  const menu = card.locator('details.menu').filter({ hasText: 'Options' });
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
}

/** Open the full filter controls under the filter summary line. */
export async function openFilters(page: Page) {
  const b = page.getByRole('button', { name: /^(Edit filters|Done)$/ });
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
}

export async function setMinPlay(page: Page, seconds: number) {
  await openFilters(page);
  const menu = page.locator('details.more-filters');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await page.getByLabel('Minimum play duration in seconds').fill(String(seconds));
}

/** Open the Overview's Data quality block (the import audit). */
/** The import audit now lives in the Data area. */
export async function openDataQuality(page: Page) {
  await goSection(page, 'Data');
  await expect(page.getByTestId('stat-plays')).toBeVisible();
}

export async function openSettings(page: Page) {
  const d = page.locator('details.settings');
  if ((await d.getAttribute('open')) === null) await d.locator('summary').click();
}
