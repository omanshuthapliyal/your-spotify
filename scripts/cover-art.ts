/**
 * Optional, user-run: download album covers from the Cover Art Archive (MusicBrainz's open
 * cover archive) for the albums in genres/album-years.local.csv (from `npm run enrich`).
 *
 * What is sent: only MusicBrainz release-group ids, to coverartarchive.org (images are served
 * from archive.org). No plays, names or listening data. Covers are saved to public/art/ (git-
 * ignored) and an index to genres/art-index.local.json; `npm run build` bakes the index in, and
 * the app shows the covers from its own server, so viewing the app makes no outside requests.
 *
 * Usage: npm run covers [-- --size 250]   (sizes: 250, 500)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/core/genres';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ''), argv[i + 1]);
const size = args.get('size') === '500' ? 500 : 250;
const dir = 'genres';
const out = 'public/art';
const indexPath = `${dir}/art-index.local.json`;
const UA = `spotify-plot-maker/0.1 (personal local script${process.env.MB_CONTACT ? `; ${process.env.MB_CONTACT}` : ''})`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = parseCsv(readFileSync(`${dir}/album-years.local.csv`, 'utf8'));
  const h = rows[0].map((c) => c.trim().toLowerCase());
  const col = (n: string) => h.indexOf(n);
  const albums = rows.slice(1).map((r) => ({ album: r[col('album')], artist: r[col('artist')], id: (r[col('musicbrainz_id')] ?? '').trim() })).filter((a) => a.id);
  mkdirSync(out, { recursive: true });
  const index: Record<string, string | null> = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
  console.log(`Fetching covers for ${albums.length} albums (only MusicBrainz ids are sent).`);
  let got = 0, none = 0, i = 0;
  for (const a of albums) {
    i++;
    const key = `${a.artist}\u0000${a.album}`;
    const file = `${out}/${a.id}-${size}.jpg`;
    if (key in index && (index[key] === null || existsSync(file))) { if (index[key]) got++; else none++; continue; }
    if (existsSync(file)) { index[key] = `art/${a.id}-${size}.jpg`; got++; continue; }
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch(`https://coverartarchive.org/release-group/${a.id}/front-${size}`, { headers: { 'User-Agent': UA } });
        if (res.status === 404) break;
        if (!res.ok) { await sleep(1500 * (attempt + 1)); continue; }
        writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
        ok = true;
      } catch {
        await sleep(1500 * (attempt + 1));
      }
    }
    index[key] = ok ? `art/${a.id}-${size}.jpg` : null;
    if (ok) got++; else none++;
    if (i % 20 === 0) { writeFileSync(indexPath, JSON.stringify(index)); process.stdout.write(`\r  ${i}/${albums.length} · ${got} covers`); }
    await sleep(400);
  }
  writeFileSync(indexPath, JSON.stringify(index));
  console.log(`\nDone: ${got} covers, ${none} albums without a cover on the archive. Rebuild (npm run build) to use them.`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
