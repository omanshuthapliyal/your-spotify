import { beforeAll, describe, expect, it } from 'vitest';
import { decadeBreakdown, parseYearInfo, resolveYears } from '../../src/core/years';
import type { PlayStore } from '../../src/core/importer';
import { EXPECTED } from '../../fixtures/synthetic';
import { importFixture } from './helpers';

let store: PlayStore;
beforeAll(async () => {
  store = (await importFixture()).store;
});
const artists = 'artist,formed_year,ended_year,type,country,musicbrainz_id\nArtist A,1991,,Group,GB,x\nArtist B,2005,2019,Person,US,y\nArtist C,,,,,\n';
const albums = 'album,artist,year,type,match,musicbrainz_id\nArtist A Album,Artist A,1994,Album,exact,a\n"Artist B Album",Artist B,1999,Album,exact,b\n';

describe('years and decades', () => {
  it('parses artist and album year files, ignoring blanks', () => {
    const info = parseYearInfo(artists, albums);
    expect(info.artistFormed.get('Artist A')).toBe(1991);
    expect(info.artistFormed.has('Artist C')).toBe(false);
    expect(info.artistMeta.get('Artist B')).toEqual({ type: 'Person', country: 'US', ended: 2019 });
    expect(info.albumYear.get('Artist B\u0000Artist B Album')).toBe(1999);
  });

  it('buckets listening by decade with an explicit Unknown, and totals reconcile', () => {
    const y = resolveYears(store, parseYearInfo(artists, albums));
    const all = [0, Date.UTC(2100, 0, 1), 30_000] as const;
    const byArtist = decadeBreakdown(store, 'artist', y.artist, ...all, null);
    expect(byArtist.map((b) => b.label)).toEqual(['1990s', '2000s', 'Unknown']);
    expect(byArtist[0].plays).toBe(600); // Artist A
    expect(byArtist[1].plays).toBe(740); // Artist B
    expect(byArtist.reduce((a, b) => a + b.ms, 0)).toBe(EXPECTED.acceptedMs);
    const byAlbum = decadeBreakdown(store, 'album', y.album, ...all, null);
    expect(byAlbum.map((b) => b.label)).toEqual(['1990s', 'Unknown']); // both albums are 1990s
    expect(byAlbum[0].items).toBe(2);
    const scoped = decadeBreakdown(store, 'artist', y.artist, ...all, (a) => (store.artistNames[a] === 'Artist A' ? 1 : 0));
    expect(scoped).toEqual([{ decade: 1990, label: '1990s', ms: 600 * 180_000, plays: 600, items: 1 }]);
  });
});
