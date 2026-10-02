/**
 * Pure helpers for the optional MusicBrainz genre lookup script (scripts/musicbrainz-genres.ts).
 * The browser app never calls MusicBrainz; the script produces a CSV the app loads offline.
 *
 * Matching rule: a MusicBrainz artist matches only if its name (or an alias) is the same as the
 * exported name after case/accent/punctuation folding. Among matches the highest search score
 * wins. If several distinct artists match with a high score, the row is flagged "ambiguous" for
 * the user to check. Genres are MusicBrainz tags that are also on MusicBrainz's official genre
 * list, ordered by vote count.
 */
import { nameVariantKey } from './importer';

export interface MbTag { name: string; count: number }
export interface MbArtist {
  id: string;
  name: string;
  score?: number;
  disambiguation?: string;
  aliases?: Array<{ name: string }>;
  tags?: MbTag[];
}

export type MatchKind = 'exact' | 'folded' | 'ambiguous' | 'none';

export interface MatchResult {
  match: MatchKind;
  artist: MbArtist | null;
  alternatives: number;
}

export function matchArtist(name: string, candidates: MbArtist[]): MatchResult {
  const key = nameVariantKey(name);
  const hits = candidates.filter((c) =>
    nameVariantKey(c.name) === key || (c.aliases ?? []).some((a) => nameVariantKey(a.name) === key));
  if (!hits.length || !key) return { match: 'none', artist: null, alternatives: 0 };
  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const strong = hits.filter((h) => (h.score ?? 0) >= 90);
  const best = hits[0];
  if (strong.length > 1) return { match: 'ambiguous', artist: best, alternatives: strong.length - 1 };
  return { match: best.name === name ? 'exact' : 'folded', artist: best, alternatives: 0 };
}

export function pickGenres(tags: MbTag[] | undefined, genreList: Set<string>, max: number): string[] {
  return (tags ?? [])
    .filter((t) => t.count > 0 && genreList.has(t.name.toLowerCase()))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((t) => titleCase(t.name));
}

/** "indie rock" -> "Indie Rock"; keeps short all-caps tokens such as "UK" or "EDM" as given. */
export function titleCase(s: string): string {
  return s.split(/(\s+|-)/).map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

/** Lucene query for an exact-phrase artist search. */
export function artistQuery(name: string): string {
  return `artist:"${name.replace(/(["\\])/g, '\\$1')}"`;
}

// ---- Enrichment: artist life-span, album release years, genre tree -------------------------

export interface MbReleaseGroup {
  id: string;
  title: string;
  score?: number;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: Array<{ name: string; artist?: { id: string; name: string } }>;
}

/** Leading 4-digit year of a MusicBrainz partial date ("1994", "1994-05", "1994-05-23"). */
export function mbYear(date: string | undefined | null): number | null {
  const m = /^(\d{4})/.exec(date ?? '');
  return m ? Number(m[1]) : null;
}

const EDITION = /\s*[([][^)\]]*(remaster|deluxe|edition|anniversary|expanded|version|bonus|reissue|mono|stereo|live at|special)[^)\]]*[)\]]\s*$/i;
const DASH_EDITION = /\s+-\s+.*(remaster|deluxe|edition|anniversary|expanded|version|bonus|reissue).*$/i;

/** Strip edition suffixes Spotify appends ("(Remastered 2011)", " - Deluxe Edition") for matching. */
export function cleanAlbumTitle(title: string): string {
  let t = title;
  for (let i = 0; i < 3; i++) t = t.replace(EDITION, '').replace(DASH_EDITION, '');
  return t.trim() || title;
}

export interface AlbumMatch {
  match: 'exact' | 'none';
  year: number | null;
  type: string | null;
  id: string | null;
}

/**
 * A release group matches when its cleaned title folds equal to the cleaned album title and its
 * artist credit is the same artist (by MusicBrainz id when known, else by folded name). Among
 * matches the EARLIEST first-release year is used, so remasters/reissues report the original year.
 */
export function matchReleaseGroup(album: string, artistName: string, artistMbid: string | null, groups: MbReleaseGroup[]): AlbumMatch {
  const key = nameVariantKey(cleanAlbumTitle(album));
  const akey = nameVariantKey(artistName);
  const hits = groups.filter((g) => {
    if (nameVariantKey(cleanAlbumTitle(g.title)) !== key) return false;
    const credits = g['artist-credit'] ?? [];
    return credits.some((c) => (artistMbid && c.artist?.id === artistMbid) || nameVariantKey(c.artist?.name ?? c.name) === akey);
  });
  if (!hits.length || !key) return { match: 'none', year: null, type: null, id: null };
  const dated = hits.filter((h) => mbYear(h['first-release-date']) !== null)
    .sort((a, b) => mbYear(a['first-release-date'])! - mbYear(b['first-release-date'])!);
  const best = dated[0] ?? hits[0];
  return { match: 'exact', year: mbYear(best['first-release-date']), type: best['primary-type'] ?? null, id: best.id };
}

export function releaseGroupQuery(album: string, artistName: string, artistMbid: string | null): string {
  const q = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;
  return `releasegroup:${q(cleanAlbumTitle(album))} AND ${artistMbid ? `arid:${artistMbid}` : `artist:${q(artistName)}`}`;
}

/**
 * Parent genres from a MusicBrainz genre web page ("subgenre of:" and "fusion of:" rows).
 * The JSON web service does not expose genre relationships, so the page's details table is read.
 */
export function parseGenreParents(html: string): Array<{ id: string; name: string; rel: 'subgenre' | 'fusion' }> {
  const out: Array<{ id: string; name: string; rel: 'subgenre' | 'fusion' }> = [];
  const rowRe = /<tr><th>(subgenre of|fusion of):<\/th><td[^>]*>([\s\S]*?)<\/td><\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const rel = m[1] === 'subgenre of' ? 'subgenre' : 'fusion';
    const linkRe = /href="\/genre\/([0-9a-f-]{36})"><bdi>([^<]+)<\/bdi>/g;
    let l: RegExpExecArray | null;
    while ((l = linkRe.exec(m[2]))) out.push({ id: l[1], name: decodeEntities(l[2]).toLowerCase(), rel });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
