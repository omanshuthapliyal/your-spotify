import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { albumListenMarks } from '../../src/core/albumListens';
import { importFiles } from '../../src/core/importer';
import { musicRecord } from '../../fixtures/synthetic';
import { NOW } from './helpers';

const MIN = 60_000;
const T0 = Date.UTC(2023, 4, 1, 18);
function rec(t: number, track: string, album = 'Rec Album', artist = 'Band') {
  const r = musicRecord(t, artist, track, 4 * MIN);
  r.master_metadata_album_album_name = album;
  return r;
}
async function store(records: unknown[]) {
  return (await importFiles([{ name: 'Streaming_History_Audio_t.json', bytes: strToU8(JSON.stringify(records)) }], { nowMs: NOW })).store;
}
const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe('albumListenMarks', () => {
  it('counts a sitting with 3+ different tracks once, not once per track play', async () => {
    // Sitting 1: tracks 1-5 back to back (5 track plays) = 1 album listen.
    const s1 = [1, 2, 3, 4, 5].map((k) => rec(T0 + k * 4 * MIN, `Track ${k}`));
    // Sitting 2, a day later: tracks 1-3 = 1 album listen.
    const s2 = [1, 2, 3].map((k) => rec(T0 + 86_400_000 + k * 4 * MIN, `Track ${k}`));
    const st = await store([...s1, ...s2]);
    const m = albumListenMarks(st, 30_000);
    expect(count(m)).toBe(2);
    expect(st.length).toBe(8); // 8 track plays
  });

  it('does not count repeating one or two songs as album listens', async () => {
    const repeats = Array.from({ length: 6 }, (_, k) => rec(T0 + k * 4 * MIN, 'Hit Single'));
    const two = [rec(T0 + 86_400_000, 'A'), rec(T0 + 86_400_000 + 4 * MIN, 'B')];
    expect(count(albumListenMarks(await store([...repeats, ...two]), 30_000))).toBe(0);
  });

  it('splits sittings on gaps over 30 minutes, tolerates other albums in between', async () => {
    const split = [rec(T0, 'T1'), rec(T0 + 4 * MIN, 'T2'), rec(T0 + 60 * MIN, 'T3')]; // 2 + 1 tracks: none qualifies
    const interleaved = [rec(T0 + 86_400_000, 'T1'), rec(T0 + 86_400_000 + 4 * MIN, 'Other', 'Other Album', 'X'),
      rec(T0 + 86_400_000 + 8 * MIN, 'T2'), rec(T0 + 86_400_000 + 12 * MIN, 'T3')]; // still one sitting with 3 tracks
    expect(count(albumListenMarks(await store([...split, ...interleaved]), 30_000))).toBe(1);
  });

  it('respects the minimum-play filter and ignores the unknown album', async () => {
    const short = [rec(T0, 'T1'), rec(T0 + 4 * MIN, 'T2'), { ...rec(T0 + 8 * MIN, 'T3'), ms_played: 10_000 }];
    const unknown = [1, 2, 3].map((k) => ({ ...rec(T0 + 86_400_000 + k * 4 * MIN, `U${k}`), master_metadata_album_album_name: null }));
    const st = await store([...short, ...unknown]);
    expect(count(albumListenMarks(st, 30_000))).toBe(0);
    expect(count(albumListenMarks(st, 0))).toBe(1);
  });
});

import { albumSittings, wholeAlbums } from '../../src/core/albumListens';

describe('whole-album listening', () => {
  const album = (t: number, tracks: number[], name = 'LP', skipLast = false) => tracks.map((k, i) => {
    const r = rec(t + i * 4 * MIN, `T${k}`, name);
    return skipLast && i === tracks.length - 1 ? { ...r, reason_end: 'fwdbtn' } : r;
  });
  it('counts sittings that cover 80%+ of the album’s known tracks without many skips', async () => {
    const st = await store([
      ...album(T0, [1, 2, 3, 4, 5]), // whole: 5/5
      ...album(T0 + 86_400_000, [1, 2, 3, 4]), // whole: 4/5 = 80%
      ...album(T0 + 2 * 86_400_000, [1, 2, 3]), // 60%: a partial listen
      ...album(T0 + 3 * 86_400_000, [1, 2, 3, 4, 5].map((x) => x), 'LP', false).map((r, i) => (i < 2 ? { ...r, reason_end: 'fwdbtn' } : r)), // 5/5 but 2 of 5 skipped (60% unskipped)
      ...album(T0 + 4 * 86_400_000, [1, 2, 3], 'Short EP'), // only 3 known tracks: not considered
    ]);
    const sit = albumSittings(st, 30_000);
    expect(sit.filter((s) => st.albumNames[s.album] === 'LP')).toHaveLength(4);
    const w = wholeAlbums(st, 30_000, 0, Date.UTC(2100, 0, 1));
    expect(w.albumsConsidered).toBe(1);
    expect(w.rows[0]).toMatchObject({ knownTracks: 5, wholeListens: 2, sittings: 4 });
    expect(w.rows[0].avgCoverage).toBeCloseTo((1 + 0.8 + 0.6 + 1) / 4, 9);
    expect(w.totalWhole).toBe(2);
    expect(w.coverage.map((c) => c.count)).toEqual([0, 0, 1, 1, 2]);
    expect(w.perYear).toEqual([{ year: 2023, count: 2 }]);
  });
});
