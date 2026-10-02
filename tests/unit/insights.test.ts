import { beforeAll, describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { computeInsights, type InsightOptions } from '../../src/core/insights';
import { offsetFn } from '../../src/core/tz';
import { importFiles, type PlayStore } from '../../src/core/importer';
import { EXPECTED, musicRecord } from '../../fixtures/synthetic';
import { importFixture, NOW } from './helpers';

let store: PlayStore;
beforeAll(async () => {
  store = (await importFixture()).store;
});
const opts = (o: Partial<InsightOptions> = {}): InsightOptions => ({
  from: 0, to: Date.UTC(2100, 0, 1), minMs: 30_000, offset: offsetFn(null), timeZone: 'UTC', albumYear: null, genreOf: null, ...o,
});
const MIN = 60_000;
const DAY = 86_400_000;

describe('timezone offsets', () => {
  it('follows daylight saving', () => {
    const ny = offsetFn('America/New_York');
    expect(ny(Date.UTC(2024, 0, 15, 12)) / 3_600_000).toBe(-5);
    expect(ny(Date.UTC(2024, 6, 15, 12)) / 3_600_000).toBe(-4);
    expect(offsetFn('UTC')(Date.UTC(2024, 6, 15))).toBe(0);
    expect(offsetFn('Asia/Kolkata')(Date.UTC(2024, 6, 15)) / 60_000).toBe(330);
  });
});

describe('computeInsights on the fixture', () => {
  it('year review: totals, eras and discoveries', () => {
    const r = computeInsights(store, opts());
    expect(r.years.map((y) => y.year)).toEqual([2019, 2020, 2021, 2022]);
    expect(r.years.reduce((s, y) => s + y.ms, 0)).toBe(EXPECTED.acceptedMs);
    expect(r.years.map((y) => y.topArtist!.name)).toEqual(['Artist A', 'Artist B', 'Artist B', 'Artist A']);
    expect(r.years.map((y) => y.newArtists)).toEqual([11, 0, 2, 0]); // A..J + Boundary; then the Sigur variants
    expect(r.years[0].topTrack!.sub).toBe('Artist A');
    expect(r.years[0].effectiveArtists).toBeGreaterThan(1);
    expect(r.years[0].top10Share).toBeGreaterThan(0.9);
  });

  it('skip rate counts all plays, including the short ones the filter removes', () => {
    const r = computeInsights(store, opts());
    // 2019: 30 quick skips out of 681 plays (649 kept + 30 skipped + 2 threshold-edge plays)
    expect(r.years[0].skipRate).toBeCloseTo(30 / 681, 9);
    expect(r.years[1].skipRate).toBe(0);
    expect(r.years[0].shuffleRate).toBe(0);
    expect(r.mostSkipped[0]).toMatchObject({ name: 'Artist C Song 1', artist: 'Artist C' });
  });

  it('discovery and stickiness, by discovery year', () => {
    const r = computeInsights(store, opts());
    // Boundary Artist (Dec 31 - Jan 1) does not stick; the Sigur variants were one quarter only.
    expect(r.discovery).toEqual([{ year: 2019, discovered: 11, stuck: 10 }, { year: 2021, discovered: 2, stuck: 0 }]);
  });

  it('uses the chosen timezone for years and days', () => {
    const berlin = computeInsights(store, opts({ offset: offsetFn('Europe/Berlin'), timeZone: 'Europe/Berlin' }));
    // 2019-12-31T23:59:59Z is 00:59 on Jan 1 in Berlin, so Boundary Artist is discovered in 2020.
    expect(berlin.discovery[0]).toMatchObject({ year: 2019, discovered: 10 });
    expect(berlin.discovery[1]).toMatchObject({ year: 2020, discovered: 1 });
  });

  it('obsessions and loyalty', () => {
    const r = computeInsights(store, opts());
    expect(r.obsessions.longestRepeat!.count).toBeGreaterThanOrEqual(2); // the identical back-to-back pair
    expect(r.obsessions.longestStreak!.days).toBeGreaterThan(1);
    expect(r.loyal[0].years).toBe(4); // B and fillers play every year
    expect(r.daysWithMusic).toBeGreaterThan(300);
  });
});

describe('visual insight series', () => {
  it('discovery by month, notable discoveries, sessions, binges, artist skips, artist timelines', () => {
    const r = computeInsights(store, opts());
    const total = r.discoveryMonthly.reduce((s, [, c]) => s + c, 0);
    expect(total).toBe(13); // every artist discovered once
    expect(r.discoveryMonthly[0]).toEqual([2019 * 12, 10]); // A..J all start in Jan 2019
    expect(r.notableDiscoveries[0].year).toBe(2019);
    expect(r.notableDiscoveries[0].artists.map((a) => a.name).slice(0, 2)).toEqual(['Artist B', 'Artist A']);
    expect(r.sessionLengths.reduce((s, b) => s + b.count, 0)).toBe(r.sessions.count);
    expect(r.sessionStartHours.reduce((s, c) => s + c, 0)).toBe(r.sessions.count);
    expect(r.topSongDays[0].plays).toBeGreaterThanOrEqual(r.topSongDays[r.topSongDays.length - 1].plays);
    const c = r.artistSkips.find((a) => a.name === 'Artist C')!;
    expect(c.skipRate).toBeCloseTo(30 / 270, 9); // 240 kept + 30 skipped
    const loyalId = r.loyal[0].id;
    expect(r.artistYears[loyalId].map(([y]) => y)).toEqual([2019, 2020, 2021, 2022]);
    expect(r.artistMonths[loyalId].length).toBeGreaterThan(10);
  });
});

describe('computeInsights on crafted data', () => {
  it('sessions, repeats, comebacks and music age', async () => {
    const t0 = Date.UTC(2023, 0, 10, 20);
    const recs = [
      ...[0, 1, 2, 3].map((k) => { const r = musicRecord(t0 + k * 4 * MIN, 'Loop', 'Same Song', 4 * MIN); r.master_metadata_album_album_name = 'Old Record'; return r; }),
      musicRecord(t0 + 3 * 3_600_000, 'Other', 'Late', 4 * MIN), // new session (gap > 30 min)
      musicRecord(t0 + 400 * DAY, 'Loop', 'Same Song', 4 * MIN), // comeback after 400 days
    ];
    const st = (await importFiles([{ name: 'a.json', bytes: strToU8(JSON.stringify(recs)) }], { nowMs: NOW })).store;
    const albumYear = st.albumNames.map((n) => (n === 'Old Record' ? 1973 : null));
    const r = computeInsights(st, opts({ albumYear }));
    expect(r.sessions.count).toBe(3);
    expect(r.sessions.longest!.plays).toBe(4);
    expect(r.sessions.longest!.minutes).toBeCloseTo(16, 6);
    expect(r.obsessions.longestRepeat).toMatchObject({ track: 'Same Song', count: 4 });
    expect(r.obsessions.biggestTrackDay).toMatchObject({ track: 'Same Song', plays: 4, completed: 4 });
    expect(r.comebacks[0]).toMatchObject({ name: 'Loop', gapDays: 400 });
    expect(r.comebacks[0].msAfter).toBe(4 * MIN);
    expect(r.years[0].medianMusicAge).toBe(50);
    expect(r.years[0].newMusicShare).toBe(0);
  });

  it('binges count skipped replays separately', async () => {
    const t0 = Date.UTC(2021, 2, 15, 22);
    const recs = [0, 1, 2].map((k) => musicRecord(t0 + k * 5 * MIN, 'Band', 'Loop', 288_000));
    recs.push({ ...musicRecord(t0 + 15 * MIN, 'Band', 'Loop', 138_000), reason_end: 'fwdbtn' });
    const st = (await importFiles([{ name: 'b.json', bytes: strToU8(JSON.stringify(recs)) }], { nowMs: NOW })).store;
    const r = computeInsights(st, opts());
    expect(r.obsessions.biggestTrackDay).toMatchObject({ track: 'Loop', plays: 4, completed: 3 });
    expect(r.topSongDays[0]).toMatchObject({ plays: 4, completed: 3 });
  });
});
