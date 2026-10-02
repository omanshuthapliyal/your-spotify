/**
 * Optional, user-run genre lookup. Takes artist names either from your Spotify export (read
 * locally, top artists by listening time) or from the app's "Download template" CSV, asks
 * MusicBrainz for each artist's genre tags, and writes a CSV you can review and load in the app.
 *
 * What is sent: only artist names, one search per artist, to musicbrainz.org. The export is
 * parsed on this machine; no plays, times, counts or other listening data are sent.
 *
 * Usage:
 *   npm run genres -- --zip ~/Downloads/my_spotify_data.zip      (or a Streaming_History_*.json)
 *   npm run genres -- --in artist-genres-template.csv
 *   options: [--out artist-genres-musicbrainz.csv] [--max-genres 1] [--limit 300] [--cache .genre-cache.json]
 * Optional: MB_CONTACT=you@example.com (MusicBrainz asks clients to include contact info).
 * Rate: MusicBrainz allows ~1 request/second, so 300 artists take about 5-6 minutes. Results are
 * cached so an interrupted run resumes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/core/genres';
import { importFiles } from '../src/core/importer';
import { basename } from 'node:path';
import { artistQuery, matchArtist, pickGenres, type MbArtist, type MatchKind } from '../src/core/musicbrainz';

interface CacheEntry { match: MatchKind; mbName: string; mbId: string; score: number; genres: string[]; alternatives: number }

const args = new Map<string, string>();
const argv = process.argv.slice(2).filter((a) => a !== '--');
for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ''), argv[i + 1]);
const input = args.get('in');
const zip = args.get('zip');
if (!input && !zip) {
  console.error('Usage: npm run genres -- --zip ~/Downloads/my_spotify_data.zip   (or --in artist-genres-template.csv)\n       [--out file.csv] [--max-genres 1] [--limit 300]');
  process.exit(1);
}
const out = args.get('out') ?? 'artist-genres-musicbrainz.csv';
const maxGenres = Number(args.get('max-genres') ?? 1);
const limit = Number(args.get('limit') ?? 300);
const cachePath = args.get('cache') ?? '.genre-cache.json';
const UA = `spotify-plot-maker/0.1 (personal local script${process.env.MB_CONTACT ? `; ${process.env.MB_CONTACT}` : ''})`;
const BASE = 'https://musicbrainz.org/ws/2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function mb(path: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 503 || res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    return res;
  }
  throw new Error('MusicBrainz kept rate-limiting; try again later.');
}

function csvCell(s: string) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Top artist names by listening time (plays of 30 s or more), parsed locally from the export. */
async function namesFromExport(path: string): Promise<string[]> {
  const { audit, store } = await importFiles([{ name: basename(path), bytes: new Uint8Array(readFileSync(path)) }]);
  if (audit.error) throw new Error(audit.error);
  const totals = new Float64Array(store.artistNames.length);
  for (let i = 0; i < store.length; i++) if (store.msPlayed[i] >= 30_000) totals[store.artist[i]] += store.msPlayed[i];
  const ids = [...totals.keys()].filter((g) => totals[g] > 0).sort((a, b) => totals[b] - totals[a] || a - b);
  const covered = ids.slice(0, limit).reduce((a, g) => a + totals[g], 0) / Math.max(1, totals.reduce((a, b) => a + b, 0));
  console.log(`Read ${audit.acceptedMusic.count} music plays locally; your top ${Math.min(limit, ids.length)} of ${ids.length} artists cover ${(covered * 100).toFixed(1)}% of listening time.`);
  return ids.slice(0, limit).map((g) => store.artistNames[g]);
}

async function main() {
  let names: string[];
  if (zip) names = await namesFromExport(zip);
  else {
    const rows = parseCsv(readFileSync(input!, 'utf8'));
    const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? [];
    const col = header.includes('artist') ? header.indexOf('artist') : 0;
    names = rows.slice(header.includes('artist') ? 1 : 0).map((r) => r[col]?.trim()).filter(Boolean).slice(0, limit);
  }
  const cache: Record<string, CacheEntry> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

  console.log(`Looking up ${names.length} artist names on MusicBrainz (only names are sent).`);
  const genreRes = await mb('/genre/all?fmt=txt');
  if (!genreRes.ok) throw new Error(`Could not fetch the MusicBrainz genre list (HTTP ${genreRes.status}).`);
  const genreList = new Set((await genreRes.text()).split('\n').map((g) => g.trim().toLowerCase()).filter(Boolean));

  let done = 0;
  for (const name of names) {
    done++;
    if (cache[name]) continue;
    const res = await mb(`/artist/?query=${encodeURIComponent(artistQuery(name))}&fmt=json&limit=8`);
    if (!res.ok) { console.warn(`  ${done}/${names.length} HTTP ${res.status} for one artist; skipped`); continue; }
    const body = (await res.json()) as { artists?: MbArtist[] };
    const m = matchArtist(name, body.artists ?? []);
    cache[name] = {
      match: m.match,
      mbName: m.artist?.name ?? '',
      mbId: m.artist?.id ?? '',
      score: m.artist?.score ?? 0,
      genres: m.artist ? pickGenres(m.artist.tags, genreList, maxGenres) : [],
      alternatives: m.alternatives,
    };
    if (done % 10 === 0 || done === names.length) {
      writeFileSync(cachePath, JSON.stringify(cache));
      process.stdout.write(`\r  ${done}/${names.length} looked up`);
    }
  }
  writeFileSync(cachePath, JSON.stringify(cache));
  process.stdout.write('\n');

  const lines = ['artist,genre,match,musicbrainz_name,musicbrainz_id,score'];
  const tally: Record<string, number> = {};
  for (const name of names) {
    const c = cache[name];
    if (!c) continue;
    const kind = c.match === 'none' ? 'none' : c.genres.length ? c.match : `${c.match}, no genre tags`;
    tally[kind] = (tally[kind] ?? 0) + 1;
    lines.push([name, c.genres.join('; '), c.match + (c.alternatives ? ` (+${c.alternatives} similar)` : ''), c.mbName, c.mbId, String(c.score)].map(csvCell).join(','));
  }
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`Wrote ${out}. Results: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  console.log('Next: in the app, open Genres > "Load genre CSV" and pick that file.');
  console.log('Optionally review rows marked "ambiguous" or "folded" first; edit the genre column freely.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
