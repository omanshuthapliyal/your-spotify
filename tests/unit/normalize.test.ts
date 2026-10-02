import { describe, expect, it } from 'vitest';
import { normalizeRecord, sniffFileKind } from '../../src/core/normalize';
import { musicRecord, FAKE_SENSITIVE } from '../../fixtures/synthetic';
import { NOW } from './helpers';

describe('normalizeRecord', () => {
  it('keeps only computation fields for music', () => {
    const r = normalizeRecord(musicRecord(Date.UTC(2020, 1, 1), 'Artist A', 'Song', 200_000), NOW);
    expect(r).toEqual({ kind: 'music', endedAt: Date.UTC(2020, 1, 1), msPlayed: 200_000, artistName: 'Artist A', trackName: 'Song', trackUri: 'spotify:track:ArtistASong', albumName: 'Artist A Album', skipped: false, shuffle: false, reasonEnd: 'trackdone' });
    const s = JSON.stringify(r);
    for (const v of Object.values(FAKE_SENSITIVE)) expect(s).not.toContain(v);
  });

  it('separates podcasts and audiobooks from music', () => {
    const base = musicRecord(Date.UTC(2020, 1, 1), null, null, 1000, null);
    expect(normalizeRecord({ ...base, spotify_episode_uri: 'spotify:episode:x', episode_name: 'E' }, NOW)).toMatchObject({ reason: 'podcast' });
    expect(normalizeRecord({ ...base, episode_show_name: 'Show' }, NOW)).toMatchObject({ reason: 'podcast' });
    expect(normalizeRecord({ ...base, audiobook_title: 'Book' }, NOW)).toMatchObject({ reason: 'audiobook' });
  });

  it('flags malformed input', () => {
    expect(normalizeRecord(null, NOW)).toMatchObject({ reason: 'malformed' });
    expect(normalizeRecord(42, NOW)).toMatchObject({ reason: 'malformed' });
    expect(normalizeRecord([1], NOW)).toMatchObject({ reason: 'malformed' });
    const ok = musicRecord(Date.UTC(2020, 1, 1), 'A', 'S', 1000);
    expect(normalizeRecord({ ...ok, ms_played: 'abc' }, NOW)).toMatchObject({ reason: 'malformed' });
    expect(normalizeRecord({ ...ok, ms_played: -5 }, NOW)).toMatchObject({ reason: 'malformed' });
    expect(normalizeRecord({ ...ok, ts: undefined }, NOW)).toMatchObject({ reason: 'malformed' });
  });

  it('flags invalid dates, including the 1970 export artefact and far-future stamps', () => {
    const ok = musicRecord(Date.UTC(2020, 1, 1), 'A', 'S', 1000);
    for (const ts of ['not-a-date', '1970-01-01T00:00:00Z', '2020-13-45T00:00:00Z', '2020-02-01 10:00', '2099-01-01T00:00:00Z']) {
      expect(normalizeRecord({ ...ok, ts }, NOW), ts).toMatchObject({ reason: 'invalidDate' });
    }
  });

  it('distinguishes missing artist from unidentifiable records, and accepts local files without a URI', () => {
    expect(normalizeRecord(musicRecord(Date.UTC(2020, 1, 1), null, 'T', 1000), NOW)).toMatchObject({ reason: 'missingArtist' });
    expect(normalizeRecord(musicRecord(Date.UTC(2020, 1, 1), null, null, 1000, null), NOW)).toMatchObject({ reason: 'unidentified' });
    expect(normalizeRecord(musicRecord(Date.UTC(2020, 1, 1), 'Local', 'Home recording', 1000, null), NOW)).toMatchObject({ kind: 'music', trackUri: null });
  });
});

describe('sniffFileKind', () => {
  it('identifies exports by schema', () => {
    expect(sniffFileKind([musicRecord(0, 'A', 'S', 1)])).toBe('extended');
    expect(sniffFileKind([{ endTime: '2023-01-01 10:00', artistName: 'A', trackName: 'S', msPlayed: 1 }])).toBe('one-year');
    expect(sniffFileKind([])).toBe('empty');
    expect(sniffFileKind({ a: 1 })).toBe('unsupported');
    expect(sniffFileKind([{ foo: 1 }])).toBe('unsupported');
  });
});
