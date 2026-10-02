/**
 * Genre mapping from a user-supplied CSV. The Spotify export has no genre field; genres come
 * only from this file.
 *
 * CSV format: `artist,genre` (header optional). Several genres for one artist may be given on
 * one row separated by ";" or in extra columns, or on several rows; they are combined.
 * With a header row that names a `genre` column, only that column is read, so extra review
 * columns (e.g. from the MusicBrainz script) are ignored.
 *
 * Multiple genres: an artist's listening time is split equally between its genres, so genre
 * totals still add up to total listening time (a play of a "rock; pop" artist counts 0.5 to each).
 * Matching is by exact exported artist name. Names that only match after case/diacritic folding
 * are reported as near matches and NOT applied. Unmapped artists count as "Unclassified".
 */
import type { Grouping } from './aggregate';
import { nameVariantKey, type PlayStore } from './importer';

export interface GenreMapping {
  genresByArtist: Map<string, string[]>;
  rows: number;
  issues: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_NAMES = new Set(['artist', 'artist name', 'artist_name', 'artistname', 'name']);

export function parseGenreCsv(text: string): GenreMapping {
  const issues: string[] = [];
  const genresByArtist = new Map<string, string[]>();
  const genreSpelling = new Map<string, string>(); // lowercased -> first spelling seen
  const rows = parseCsv(text);
  let start = 0;
  let genreCol = -1;
  if (rows.length && HEADER_NAMES.has(rows[0][0].trim().toLowerCase())) {
    start = 1;
    genreCol = rows[0].findIndex((c) => ['genre', 'genres'].includes(c.trim().toLowerCase()));
  }
  let used = 0;
  let noGenre = 0;
  const repeated = new Set<string>();
  for (let r = start; r < rows.length; r++) {
    const artist = rows[r][0].trim();
    const cells = genreCol > 0 ? [rows[r][genreCol] ?? ''] : rows[r].slice(1);
    const genres = cells.flatMap((c) => c.split(';')).map((g) => g.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!artist) { issues.push(`Row ${r + 1}: missing artist name; skipped.`); continue; }
    if (!genres.length) {
      noGenre++;
      if (noGenre <= 5) issues.push(`Row ${r + 1}: "${artist}" has no genre; skipped.`);
      continue;
    }
    used++;
    const list = genresByArtist.get(artist) ?? [];
    if (genresByArtist.has(artist)) repeated.add(artist);
    for (const g of genres) {
      const key = g.toLowerCase();
      let label = genreSpelling.get(key);
      if (label === undefined) { genreSpelling.set(key, g); label = g; }
      else if (label !== g) issues.push(`Genre "${g}" treated as "${label}" (same name, different capitalisation).`);
      if (!list.includes(label)) list.push(label);
    }
    genresByArtist.set(artist, list);
  }
  if (noGenre > 5) issues.push(`…and ${noGenre - 5} more artists with no genre (counted as Unclassified).`);
  for (const a of repeated) issues.push(`"${a}" appears on several rows; its genres were combined.`);
  return { genresByArtist, rows: used, issues };
}

export interface GenreGroupingInfo {
  grouping: Grouping;
  mappedArtists: number;
  multiGenreArtists: number;
  unmatchedCsvArtists: string[];
  nearMatches: Array<{ csv: string; exported: string[] }>;
  issues: string[];
}

export const UNCLASSIFIED = 'Unclassified';

export function buildGenreGrouping(store: PlayStore, mapping: GenreMapping): GenreGroupingInfo {
  const labels: string[] = [];
  const genreId = new Map<string, number>();
  const idOf = (g: string) => {
    let id = genreId.get(g);
    if (id === undefined) { id = labels.length; labels.push(g); genreId.set(g, id); }
    return id;
  };
  const perArtist: Array<ReadonlyArray<readonly [number, number]>> = [];
  let mapped = 0;
  let multi = 0;
  const exportNames = new Set(store.artistNames);
  const pending: Array<string[] | undefined> = store.artistNames.map((a) => mapping.genresByArtist.get(a));
  // Assign genre ids in a deterministic order first, then Unclassified last.
  for (const gs of pending) gs?.forEach(idOf);
  const unclassified = labels.length;
  labels.push(UNCLASSIFIED);
  pending.forEach((gs, a) => {
    if (gs && gs.length) {
      mapped++;
      if (gs.length > 1) multi++;
      perArtist[a] = gs.map((g) => [genreId.get(g)!, 1 / gs.length] as const);
    } else perArtist[a] = [[unclassified, 1]];
  });

  const byKey = new Map<string, string[]>();
  for (const n of store.artistNames) {
    const k = nameVariantKey(n);
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }
  const unmatched: string[] = [];
  const near: Array<{ csv: string; exported: string[] }> = [];
  for (const csvName of mapping.genresByArtist.keys()) {
    if (exportNames.has(csvName)) continue;
    const candidates = byKey.get(nameVariantKey(csvName));
    if (candidates) near.push({ csv: csvName, exported: [...candidates].sort() });
    else unmatched.push(csvName);
  }
  return {
    grouping: { kind: 'genre', column: 'artist', labels, ofKey: (a) => perArtist[a], pinnedGroup: unclassified },
    mappedArtists: mapped,
    multiGenreArtists: multi,
    unmatchedCsvArtists: unmatched,
    nearMatches: near,
    issues: mapping.issues,
  };
}
