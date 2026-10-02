import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/worker/engine';
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from '../../src/report/types';
import { FAKE_SENSITIVE } from '../../fixtures/synthetic';
import { fixtureInputs } from './helpers';

const settings = { granularity: 'quarter' as const, metric: 'hours' as const, topN: 6, minMs: 30_000, range: null };
async function report(o: Partial<ReportOptions> = {}) {
  const e = new Engine();
  await e.import(fixtureInputs());
  e.setArt({ 'Artist A\u0000Artist A Album': 'art/a.jpg' });
  return e.reportData(settings, { ...DEFAULT_REPORT_OPTIONS, ...o, sections: { ...DEFAULT_REPORT_OPTIONS.sections, ...(o.sections ?? {}) } }, 'UTC');
}
const isMonthStart = (t: number) => { const d = new Date(t); return d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0; };

describe('shareable report data', () => {
  it('contains summary statistics only, never identifying fields', async () => {
    const r = await report({ sections: { ...DEFAULT_REPORT_OPTIONS.sections, routine: true }, precision: 'day' });
    const json = JSON.stringify(r);
    for (const v of Object.values(FAKE_SENSITIVE)) expect(json).not.toContain(v);
    expect(json).not.toMatch(/ip_addr|conn_country|user_agent|username|platform/);
    expect(r.format).toBe('listening-report');
    expect(json.length).toBeLessThan(400_000);
  });

  it('leaves out excluded sections entirely', async () => {
    const r = await report({ sections: { story: true, artists: false, albums: false, songs: true, genres: false, habits: false, routine: false, patterns: false } });
    expect(r.artists).toBeUndefined();
    expect(r.patterns).toBeUndefined();
    expect(r.albums).toBeUndefined();
    expect(r.habits).toBeUndefined();
    expect(r.songs!.list!.length).toBeGreaterThan(0);
    expect(r.story!.summary.plays).toBe(2429);
  });

  it('strips routine-revealing data unless asked for', async () => {
    const r = await report();
    const ins = r.habits!;
    expect(ins.days).toEqual([]);
    expect(ins.sessionStartHours).toEqual([]);
    expect(ins.sessions.longest).toBeNull();
    expect(ins.obsessions).toEqual({ biggestTrackDay: null, biggestArtistDay: null, longestRepeat: null, longestStreak: null });
    expect(ins.topSongDays).toEqual([]);
    expect(r.story!.summary.activeDays).toBe(0);
    const withRoutine = await report({ precision: 'day', sections: { ...DEFAULT_REPORT_OPTIONS.sections, routine: true } });
    expect(withRoutine.habits!.days.length).toBeGreaterThan(300);
  });

  it('month precision rounds every date in the data, and drops the daily calendar', async () => {
    const r = await report({ sections: { ...DEFAULT_REPORT_OPTIONS.sections, routine: true } });
    for (const row of [...r.artists!.list!, ...r.songs!.list!, ...r.albums!.list!]) {
      expect(isMonthStart(row.first)).toBe(true);
      expect(isMonthStart(row.last)).toBe(true);
    }
    expect(isMonthStart(r.story!.summary.first!)).toBe(true);
    expect(r.habits!.days).toEqual([]);
    for (const c of r.habits!.comebacks) expect(isMonthStart(c.returnedAt)).toBe(true);
    const ls = r.habits!.obsessions.longestStreak;
    if (ls) expect(isMonthStart(ls.startDay * 86_400_000)).toBe(true);
  });

  it('can omit covers', async () => {
    const withCovers = await report();
    expect(withCovers.albums!.list!.some((x) => x.art === 'art/a.jpg')).toBe(true);
    const r = await report({ covers: false });
    expect(JSON.stringify(r)).not.toContain('art/a.jpg');
  });

  it('a single-plot report holds only that plot and its data', async () => {
    const map = await report({ plot: 'map' });
    expect(map.plot).toBe('map');
    expect(Object.keys(map.patterns!)).toEqual(['map']);
    expect(map.patterns!.map!.nodes.length).toBeGreaterThan(0);
    for (const k of ['story', 'top', 'artists', 'albums', 'songs', 'genres', 'habits'] as const) expect(map[k]).toBeUndefined();

    const tl = await report({ plot: 'albums-timeline' });
    expect(Object.keys(tl.albums!)).toEqual(['timeline']);
    expect(tl.patterns).toBeUndefined();

    const whole = await report({ plot: 'albums-whole' });
    expect(Object.keys(whole.albums!)).toEqual(['whole']);

    // Routine plots switch the routine data on; others keep it out.
    expect((await report({ plot: 'habits-calendar', precision: 'day' })).routine).toBe(true);
    const disc = await report({ plot: 'habits-discovery' });
    expect(disc.routine).toBe(false);
    expect(disc.habits!.days).toEqual([]);

    // A single plot is far smaller than the whole report.
    const full = JSON.stringify(await report({})).length;
    expect(JSON.stringify(tl).length).toBeLessThan(full / 3);
  });
});
