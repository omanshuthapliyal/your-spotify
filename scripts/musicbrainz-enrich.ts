/**
 * Optional, user-run enrichment from MusicBrainz (run after `npm run genres`):
 *   1. Genre tree: parent genres ("subgenre of" / "fusion of") for every genre in your mapping,
 *      followed upward to the roots. Read from MusicBrainz genre pages (the JSON API does not
 *      expose genre relationships).
 *   2. Artists: formation/birth year, end year, type and country for your top artists.
 *   3. Albums: original release year and type for your top albums.
 *
 * What is sent: genre ids, artist names, and album title + artist name pairs. The export is
 * parsed on this machine; no plays, times or counts are sent.
 *
 * Usage:
 *   npm run enrich -- --zip ~/Downloads/my_spotify_data.zip [--artists 1000] [--albums 1000]
 * Writes genres/genre-tree.local.json, genres/artist-info.local.csv, genres/album-years.local.csv.
 * ~1 request/second; results are cached in genres/.enrich-cache.json so reruns resume.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importFiles } from '../src/core/importer';
import { parseCsv } from '../src/core/genres';
import {
  artistQuery, matchArtist, matchReleaseGroup, mbYear, parseGenreParents, releaseGroupQuery,
  type MbArtist, type MbReleaseGroup,
} from '../src/core/musicbrainz';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ''), argv[i + 1]);
const zip = args.get('zip');
if (!zip) {
  console.error('Usage: npm run enrich -- --zip ~/Downloads/my_spotify_data.zip [--artists 1000] [--albums 1000]');
  process.exit(1);
}
const nArtists = Number(args.get('artists') ?? 1000);
const nAlbums = Number(args.get('albums') ?? 1000);
const dir = args.get('dir') ?? 'genres';
const cachePath = `${dir}/.enrich-cache.json`;
const UA = `spotify-plot-maker/0.1 (personal local script${process.env.MB_CONTACT ? `; ${process.env.MB_CONTACT}` : ''})`;

interface ArtistInfo { mbid: string; formed: number | null; ended: number | null; type: string; country: string; match: string }
interface AlbumInfo { year: number | null; type: string; mbid: string; match: string }
interface Cache {
  genreIds?: Record<string, string>;
  genrePages: Record<string, Array<{ id: string; name: string; rel: string }>>;
  artists: Record<string, ArtistInfo>;
  albums: Record<string, AlbumInfo>;
}
const cache: Cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { genrePages: {}, artists: {}, albums: {} };
const save = () => writeFileSync(cachePath, JSON.stringify(cache));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url: string, accept = 'application/json'): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
      if (res.status === 503 || res.status === 429) { await sleep(2500 * (attempt + 1)); continue; }
      return res;
    } catch {
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error('MusicBrainz is not responding; rerun later (progress is cached).');
}
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const progress = (label: string, i: number, n: number) => { if (i % 25 === 0 || i === n) process.stdout.write(`\r  ${label}: ${i}/${n}   `); };

async function genreTree(genres: string[]) {
  if (!cache.genreIds) {
    const ids: Record<string, string> = {};
    for (let offset = 0; ; offset += 100) {
      const res = await get(`https://musicbrainz.org/ws/2/genre/all?fmt=json&limit=100&offset=${offset}`);
      const body = (await res.json()) as { 'genre-count': number; genres: Array<{ id: string; name: string }> };
      for (const g of body.genres) ids[g.name.toLowerCase()] = g.id;
      if (offset + 100 >= body['genre-count']) break;
    }
    cache.genreIds = ids;
    save();
  }
  const ids = cache.genreIds!;
  const queue = genres.filter((g) => ids[g]);
  const seen = new Set<string>();
  let i = 0;
  while (queue.length && seen.size < 600) {
    const g = queue.shift()!;
    if (seen.has(g)) continue;
    seen.add(g);
    i++;
    if (!cache.genrePages[g]) {
      const res = await get(`https://musicbrainz.org/genre/${ids[g]}`, 'text/html');
      cache.genrePages[g] = res.ok ? parseGenreParents(await res.text()) : [];
      if (i % 10 === 0) save();
    }
    for (const p of cache.genrePages[g]) if (!seen.has(p.name)) queue.push(p.name);
    progress('genre pages', i, i + queue.length);
  }
  save();
  process.stdout.write('\n');
  const tree: Record<string, { parents: Array<{ name: string; rel: string }> }> = {};
  for (const g of seen) tree[g] = { parents: (cache.genrePages[g] ?? []).map(({ name, rel }) => ({ name, rel })) };
  writeFileSync(`${dir}/genre-tree.local.json`, JSON.stringify({ source: 'MusicBrainz genre relationships (subgenre of / fusion of)', genres: tree }, null, 1));
  const unknown = genres.filter((g) => !ids[g]);
  console.log(`Genre tree: ${seen.size} genres (incl. ancestors).${unknown.length ? ` ${unknown.length} mapped genres are not on MusicBrainz's genre list.` : ''}`);
}

async function main() {
  const { audit, store } = await importFiles([{ name: basename(zip!), bytes: new Uint8Array(readFileSync(zip!)) }]);
  if (audit.error) throw new Error(audit.error);
  console.log(`Read ${audit.acceptedMusic.count} music plays locally. Only genre ids, artist names and album titles are sent.`);

  // Existing genre mapping: genres for the tree, and artist MusicBrainz ids to keep matches consistent.
  const mappingPath = `${dir}/artist-genres.local.csv`;
  const knownMbid = new Map<string, string>();
  const genres = new Set<string>();
  if (existsSync(mappingPath)) {
    const rows = parseCsv(readFileSync(mappingPath, 'utf8'));
    const h = rows[0].map((c) => c.trim().toLowerCase());
    for (const r of rows.slice(1)) {
      const g = r[h.indexOf('genre')]?.trim();
      if (g) g.split(';').forEach((x) => genres.add(x.trim().toLowerCase()));
      const id = r[h.indexOf('musicbrainz_id')]?.trim();
      if (id) knownMbid.set(r[h.indexOf('artist')], id);
    }
  }
  if (genres.size) await genreTree([...genres]);

  // Top artists and albums by listening time (plays of at least 30 s).
  const aMs = new Float64Array(store.artistNames.length);
  const alMs = new Float64Array(store.albumNames.length);
  for (let i = 0; i < store.length; i++) {
    if (store.msPlayed[i] < 30_000) continue;
    aMs[store.artist[i]] += store.msPlayed[i];
    alMs[store.album[i]] += store.msPlayed[i];
  }
  const topArtists = [...aMs.keys()].filter((a) => aMs[a] > 0).sort((a, b) => aMs[b] - aMs[a]).slice(0, nArtists);
  const topAlbums = [...alMs.keys()].filter((a) => alMs[a] > 0 && store.albumNames[a] !== '(unknown album)').sort((a, b) => alMs[b] - alMs[a]).slice(0, nAlbums);

  let i = 0;
  for (const a of topArtists) {
    const name = store.artistNames[a];
    progress('artists', ++i, topArtists.length);
    if (cache.artists[name]) continue;
    const res = await get(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(artistQuery(name))}&fmt=json&limit=8`);
    if (!res.ok) continue;
    const list = ((await res.json()) as { artists?: Array<MbArtist & { type?: string; country?: string; 'life-span'?: { begin?: string; end?: string } }> }).artists ?? [];
    const known = knownMbid.get(name);
    const pick = (known && list.find((x) => x.id === known)) || matchArtist(name, list).artist;
    const full = pick as (typeof list)[number] | null;
    cache.artists[name] = full
      ? { mbid: full.id, formed: mbYear(full['life-span']?.begin), ended: mbYear(full['life-span']?.end), type: full.type ?? '', country: full.country ?? '', match: known && full.id === known ? 'same as genre match' : 'name' }
      : { mbid: '', formed: null, ended: null, type: '', country: '', match: 'none' };
    if (i % 20 === 0) save();
  }
  save();
  process.stdout.write('\n');

  i = 0;
  for (const al of topAlbums) {
    const artist = store.artistNames[store.albumArtist[al]];
    const title = store.albumNames[al];
    const key = `${artist}\u0000${title}`;
    progress('albums', ++i, topAlbums.length);
    if (cache.albums[key]) continue;
    const mbid = cache.artists[artist]?.mbid || knownMbid.get(artist) || null;
    const res = await get(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(releaseGroupQuery(title, artist, mbid))}&fmt=json&limit=15`);
    if (!res.ok) continue;
    const groups = ((await res.json()) as { 'release-groups'?: MbReleaseGroup[] })['release-groups'] ?? [];
    const m = matchReleaseGroup(title, artist, mbid, groups);
    cache.albums[key] = { year: m.year, type: m.type ?? '', mbid: m.id ?? '', match: m.match };
    if (i % 20 === 0) save();
  }
  save();
  process.stdout.write('\n');

  const aLines = ['artist,formed_year,ended_year,type,country,musicbrainz_id'];
  for (const a of topArtists) {
    const n = store.artistNames[a];
    const c = cache.artists[n];
    if (c) aLines.push([n, c.formed ?? '', c.ended ?? '', c.type, c.country, c.mbid].map((v) => csvCell(String(v))).join(','));
  }
  writeFileSync(`${dir}/artist-info.local.csv`, aLines.join('\n') + '\n');
  const alLines = ['album,artist,year,type,match,musicbrainz_id'];
  for (const al of topAlbums) {
    const artist = store.artistNames[store.albumArtist[al]];
    const c = cache.albums[`${artist}\u0000${store.albumNames[al]}`];
    if (c) alLines.push([store.albumNames[al], artist, c.year ?? '', c.type, c.match, c.mbid].map((v) => csvCell(String(v))).join(','));
  }
  writeFileSync(`${dir}/album-years.local.csv`, alLines.join('\n') + '\n');
  const aYears = topArtists.filter((a) => cache.artists[store.artistNames[a]]?.formed).length;
  const alYears = topAlbums.filter((al) => cache.albums[`${store.artistNames[store.albumArtist[al]]}\u0000${store.albumNames[al]}`]?.year).length;
  console.log(`Artists with a formation/birth year: ${aYears}/${topArtists.length}. Albums with a release year: ${alYears}/${topAlbums.length}.`);
  console.log(`Wrote ${dir}/genre-tree.local.json, ${dir}/artist-info.local.csv, ${dir}/album-years.local.csv. Rebuild (npm run build) to bake them in.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
