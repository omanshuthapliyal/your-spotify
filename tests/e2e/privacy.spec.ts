import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { goSection, uploadZip, exportAs } from './helpers';

test('no network requests beyond the app’s own files, and no persistence', async ({ page, baseURL }) => {
  const requests: Array<{ url: string; method: string; type: string }> = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  page.on('websocket', (ws) => requests.push({ url: ws.url(), method: 'WS', type: 'websocket' }));

  await uploadZip(page);
  const afterLoad = requests.length;
  await page.getByRole('radio', { name: 'Month' }).click();
  await page.getByRole('radio', { name: 'Share' }).click();
  await page.getByRole('radio', { name: 'Flow' }).click();
  await exportAs(page, 'SVG');
  await exportAs(page, 'PNG');
  await goSection(page, 'Genres');
  await page.getByTestId('genre-input').setInputFiles(join(import.meta.dirname, '..', '..', 'fixtures', 'genres_sample.csv'));
  await page.locator('[data-node="g:indie rock"]').first().click();
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: /^Patterns/ }).click();
  await expect(page.getByTestId('colisten-map')).toBeVisible();
  await goSection(page, 'Albums');
  await page.getByRole('tab', { name: /^Top / }).click();
  await page.getByTestId('board-row').first().click();
  await page.waitForTimeout(500);

  const origin = new URL(baseURL!).origin;
  for (const r of requests) {
    const external = !(r.url.startsWith(origin) || r.url.startsWith('blob:') || r.url.startsWith('data:'));
    expect(external, `external request: ${r.method} ${r.url}`).toBe(false);
    expect(['GET'], `non-GET request: ${r.method} ${r.url}`).toContain(r.method);
  }
  // After the app has loaded, interaction causes no requests except local blob: URLs for exports.
  const later = requests.slice(afterLoad).filter((r) => !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  expect(later, JSON.stringify(later)).toEqual([]);
  test.info().annotations.push({ type: 'requests', description: requests.map((r) => `${r.method} ${r.type} ${r.url.replace(origin, '')}`).join('\n') });

  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    sw: (await navigator.serviceWorker.getRegistrations()).length,
    caches: (await caches.keys()).length,
    cookie: document.cookie,
  }));
  expect(storage).toEqual({ local: 0, session: 0, idb: 0, sw: 0, caches: 0, cookie: '' });

  // Reload clears everything: the import screen is back.
  await page.reload();
  await expect(page.getByText('Load your Extended Streaming History')).toBeVisible();
  await expect(page.getByTestId('stat-plays')).toHaveCount(0);
});

test('Content Security Policy blocks network access from the page and the worker', async ({ page }) => {
  // Count any request that actually leaves the browser for the probe host.
  let escaped = 0;
  await page.context().route('https://example.com/**', (route) => { escaped++; return route.fulfill({ status: 204 }); });
  await uploadZip(page);
  const pageFetch = await page.evaluate(() => fetch('https://example.com/').then(() => 'allowed', () => 'blocked'));
  expect(pageFetch).toBe('blocked');
  // sendBeacon reports "queued" before CSP is enforced, so check that nothing was actually sent.
  await page.evaluate(() => { try { navigator.sendBeacon('https://example.com/beacon', 'x'); } catch { /* blocked */ } });
  await page.evaluate(() => { const i = new Image(); i.src = 'https://example.com/pixel.gif'; document.body.appendChild(i); });
  const workers = page.workers();
  expect(workers.length).toBe(1);
  const workerFetch = await workers[0].evaluate(() => fetch('https://example.com/').then(() => 'allowed', () => 'blocked'));
  expect(workerFetch).toBe('blocked');
  const sameOriginFromWorker = await workers[0].evaluate(() => fetch('/').then(() => 'allowed', () => 'blocked'));
  expect(sameOriginFromWorker).toBe('blocked'); // connect-src 'none'
  await page.waitForTimeout(500);
  expect(escaped).toBe(0);
  // Negative control: the same probe from a page without our CSP IS observed, so 0 above is meaningful.
  const control = await page.context().newPage();
  await control.goto('about:blank');
  await control.evaluate(() => fetch('https://example.com/control', { mode: 'no-cors' }).catch(() => undefined));
  await expect.poll(() => escaped).toBe(1);
});
