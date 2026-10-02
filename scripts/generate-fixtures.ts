/** Writes the deterministic synthetic fixtures to fixtures/generated/ for manual and browser testing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extendedFixtureFiles, extendedFixtureZip, oneYearFixture, largeFixture, buildExtendedFixture, musicRecord } from '../fixtures/synthetic';

const root = join(import.meta.dirname, '..', 'fixtures', 'generated');
const ext = join(root, 'extended');
mkdirSync(ext, { recursive: true });
mkdirSync(join(root, 'stray'), { recursive: true });
for (const f of extendedFixtureFiles()) writeFileSync(join(ext, f.name), f.content);
writeFileSync(join(root, 'synthetic_extended_history.zip'), extendedFixtureZip());
const oy = oneYearFixture();
writeFileSync(join(root, oy.name), oy.content);
writeFileSync(join(root, 'not_streaming_history.json'), JSON.stringify({ hello: 'world' }));
writeFileSync(join(root, 'empty.json'), '[]');
// Same history plus three stray plays in 2016, long before regular listening (range-detection check).
const { audio0 } = buildExtendedFixture();
const stray = [Date.UTC(2016, 2, 14, 10), Date.UTC(2016, 2, 14, 11), Date.UTC(2017, 5, 2, 9)].map((t) => musicRecord(t, 'Old Flame', 'Way Back', 200_000));
writeFileSync(join(root, 'stray', 'Streaming_History_Audio_2016-2020_0.json'), JSON.stringify([...stray, ...audio0]));

const largeCount = Number(process.env.LARGE_RECORDS ?? 250_000);
const largeDir = join(root, 'large');
mkdirSync(largeDir, { recursive: true });
writeFileSync(join(largeDir, 'Streaming_History_Audio_large_0.json'), largeFixture(largeCount));
console.log(`Fixtures written to ${root} (large fixture: ${largeCount} records)`);
