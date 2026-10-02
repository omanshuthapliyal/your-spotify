import { expect, test, type Page } from '@playwright/test';
import { uploadZip, toggleTable } from './helpers';

async function tableTotals(page: Page) {
  await toggleTable(page);
  const rows = await page.locator('.data-table tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll('th,td')].map((c) => c.textContent ?? '');
    return { label: cells[0], total: cells[cells.length - 1] };
  }));
  await toggleTable(page);
  return rows;
}

async function flowTotals(page: Page) {
  return page.locator('rect[data-node]').evaluateAll((els) => {
    const m: Record<string, number> = {};
    for (const e of els) m[e.getAttribute('data-period')!] = (m[e.getAttribute('data-period')!] ?? 0) + Number(e.getAttribute('data-value'));
    return m;
  });
}

for (const metric of ['Hours', 'Share', 'Plays']) {
  test(`flow column totals match the stacked view (${metric})`, async ({ page }) => {
    await uploadZip(page);
    await page.getByRole('radio', { name: metric }).click();
    const table = await tableTotals(page);
    await page.getByRole('radio', { name: 'Flow' }).click();
    await expect(page.locator('rect[data-node]').first()).toBeVisible();
    const flow = await flowTotals(page);
    for (const row of table) {
      if (row.total === 'no plays') {
        expect(flow[row.label]).toBeUndefined();
        continue;
      }
      const v = flow[row.label];
      const shown = Number(row.total.replace(/[^0-9.]/g, ''));
      // Table shows 1 decimal (hours/share) or integers (plays): allow half a display unit.
      expect(Math.abs(v - shown), `${row.label}: flow ${v} vs table ${row.total}`).toBeLessThanOrEqual(metric === 'Plays' ? 0 : 0.05 + 1e-9);
    }
    // Other is part of the flow
    await expect(page.locator('rect[data-node="Other artists"]')).toHaveCount(15);
  });
}

test('flow shows eras, empty period, and same-artist ribbons only', async ({ page }) => {
  await uploadZip(page);
  await page.getByRole('radio', { name: 'Flow' }).click();
  await expect(page.locator('[data-empty-period="2020 Q3"]')).toHaveCount(1);
  await expect(page.locator('rect[data-node="Artist A"]')).toHaveCount(10);
  await expect(page.locator('path[data-ribbon="Artist A"]')).toHaveCount(8);
  await expect(page.locator('.chart-note')).toContainText('it does not show listening moving between artists');
  await page.locator('path[data-ribbon="Artist B"]').nth(3).hover({ force: true });
  await expect(page.locator('.tooltip')).toContainText('Change');
  await page.locator('rect[data-node="Artist A"]').first().click();
  await expect(page.locator('#entity-title')).toHaveText('Artist A');
});
