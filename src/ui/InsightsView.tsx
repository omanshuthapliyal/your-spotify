import { useState, type ReactNode } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { Insights } from '../core/insights';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { useWidth } from './useWidth';
import type { Theme } from './theme';
import { fmtHours, fmtInt } from './format';
import { ColumnBars, HBars, HeatRows, MonthBars, monthColumns } from './InsightCharts';

const DAY = 86_400_000;
const fmtDay = (day: number) => new Date(day * DAY).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const RAMP_LIGHT = ['#eef4fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
const RAMP_DARK = ['#1f2530', '#163056', '#184f95', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec'];

/** GitHub-style calendar: one row of weeks per year, darker = more listening that day. */
function Calendar({ days, theme }: { days: Array<[number, number]>; theme: Theme }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ day: number; ms: number; x: number; y: number } | null>(null);
  if (!days.length) return null;
  const map = new Map(days);
  const max = Math.max(...days.map(([, v]) => v));
  const ramp = theme.name === 'dark' ? RAMP_DARK : RAMP_LIGHT;
  const firstYear = new Date(days[0][0] * DAY).getUTCFullYear();
  const lastYear = new Date(days[days.length - 1][0] * DAY).getUTCFullYear();
  const yearsList = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const left = 40;
  const cell = Math.max(5, Math.min(14, Math.floor((width - left) / 54)));
  const rowH = cell * 7 + 14;
  const height = yearsList.length * rowH + 20;
  const color = (v: number) => {
    if (!v) return theme.emptyBand;
    const k = Math.min(ramp.length - 1, Math.floor(Math.sqrt(v / max) * (ramp.length - 1) + 0.5));
    return ramp[Math.max(1, k)];
  };
  return (
    <div ref={ref} className="chart-wrap" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Daily listening calendar, one row per year" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" onPointerLeave={() => setHover(null)}>
        {yearsList.map((y, yi) => {
          const jan1 = Date.UTC(y, 0, 1) / DAY;
          const startDow = (new Date(Date.UTC(y, 0, 1)).getUTCDay() + 6) % 7;
          const n = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
          const top = yi * rowH + 14;
          return (
            <g key={y}>
              <text x={0} y={top + cell * 3.5} dy="0.35em" fontSize={11.5} fill={theme.ink2}>{y}</text>
              {Array.from({ length: n }, (_, k) => {
                const d = jan1 + k;
                const idx = k + startDow;
                const v = map.get(d) ?? 0;
                return <rect key={k} x={left + Math.floor(idx / 7) * cell} y={top + (idx % 7) * cell} width={cell - 1.5} height={cell - 1.5} rx={2} fill={color(v)}
                  data-day={d} onPointerEnter={() => setHover({ day: d, ms: v, x: left + Math.floor(idx / 7) * cell, y: top + (idx % 7) * cell })} />;
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" role="status" style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 14 }}>
          <div className="tt-title">{fmtDay(hover.day)}</div>
          <div className="tt-row"><span>Listening</span><b>{hover.ms ? fmtHours(hover.ms) : 'none'}</b></div>
        </div>
      )}
    </div>
  );
}

/** Small per-year bar chart with optional second series drawn as an inner bar. */
function YearBars({ rows, theme, fmt, label, inner, innerLabel }: {
  rows: Array<{ year: number; v: number | null; inner?: number | null }>; theme: Theme; fmt: (v: number) => string; label: string; inner?: boolean; innerLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 140;
  const max = Math.max(1e-9, ...rows.map((r) => r.v ?? 0));
  const bw = Math.max(16, Math.min(70, (width - 10) / Math.max(1, rows.length)));
  return (
    <div ref={ref}>
      <svg width={width} height={H + 34} role="img" aria-label={`${label} per year: ${rows.map((r) => `${r.year} ${r.v === null ? 'n/a' : fmt(r.v)}`).join(', ')}`} fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif">
        {rows.map((r, i) => {
          const x = i * bw + bw * 0.15;
          const w = bw * 0.7;
          const h = r.v === null ? 0 : (r.v / max) * H;
          const hi = r.inner == null ? 0 : (r.inner / max) * H;
          return (
            <g key={r.year} data-year={r.year}>
              <rect x={x} y={H - h + 14} width={w} height={h} rx={3} fill={inner ? theme.series[8] : theme.series[0]}><title>{`${r.year}: ${r.v === null ? 'n/a' : fmt(r.v)}`}</title></rect>
              {inner && r.inner != null && <rect x={x} y={H - hi + 14} width={w} height={hi} rx={3} fill={theme.series[0]}><title>{`${r.year}: ${fmt(r.inner)} ${innerLabel ?? ''}`}</title></rect>}
              {r.v !== null && bw >= 30 && <text x={x + w / 2} y={H - h + 10} textAnchor="middle" fontSize={10.5} fill={theme.ink2}>{fmt(r.v)}</text>}
              <text x={x + w / 2} y={H + 30} textAnchor="middle" fontSize={11} fill={theme.muted}>{bw < 34 ? `'${String(r.year).slice(2)}` : r.year}</text>
            </g>
          );
        })}
        <line x1={0} x2={rows.length * bw} y1={H + 14} y2={H + 14} stroke={theme.axis} />
      </svg>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="istat"><span className="stat-label">{label}</span><b>{value}</b>{sub && <small className="muted">{sub}</small>}</div>;
}

/** Section index for the Habits sub-nav (id, label). */
export const HABIT_SECTIONS: Array<[string, string]> = [
  ['h-calendar', 'Calendar'], ['h-clock', 'Time of day'], ['h-discovery', 'Discovery'], ['h-variety', 'Variety'], ['h-skips', 'Skips'],
  ['h-shuffle', 'Shuffle'], ['h-age', 'Music age'], ['h-sessions', 'Sessions'], ['h-obsessions', 'Obsessions'], ['h-comebacks', 'Comebacks'], ['h-loyal', 'Loyalty'],
];

export function InsightsView({ client, theme, settings, timeZone, version, onOpenArtist, clock }: {
  client: WorkerClient; theme: Theme; settings: AggregateSettings; timeZone: string; version: number; onOpenArtist: (id: number) => void; clock?: ReactNode;
}) {
  const { data: ins, stale } = useWorkerQuery<Insights>(client, () => [{ type: 'insights', settings, timeZone }], [client, settings, timeZone, version]);
  if (!ins) return <section className="card"><p className="muted">Working out your listening habits…</p></section>;
  return <InsightsBody ins={ins} theme={theme} onOpenArtist={onOpenArtist} clock={clock} stale={stale} />;
}

/**
 * Pure display of insights (also used by the shareable report). `routine: false` leaves out the
 * parts that reveal a daily routine: the calendar, time of day, sessions and day-level obsessions.
 */
export function InsightsBody({ ins, theme, onOpenArtist, clock, stale = false, routine = true, dayFmt = fmtDay, only }: {
  ins: Insights; theme: Theme; onOpenArtist?: (id: number) => void; clock?: ReactNode; stale?: boolean; routine?: boolean; dayFmt?: (day: number) => string;
  /** Render only this section (its id, e.g. 'h-discovery'), for single-plot embeds. */
  only?: string;
}) {
  const show = (id: string) => !only || only === id;
  const open = (id: number) => (onOpenArtist ? () => onOpenArtist(id) : undefined);
  const ys = ins.years;
  const o = ins.obsessions;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const monthOfDay = (d: number) => { const dt = new Date(d * DAY); return dt.getUTCFullYear() * 12 + dt.getUTCMonth(); };
  // Month range: from the calendar, or (when routine data is left out) from the discovery months.
  const fromMonth = ins.days.length ? monthOfDay(ins.days[0][0]) : ins.discoveryMonthly[0]?.[0] ?? 0;
  const toMonth = ins.days.length ? monthOfDay(ins.days[ins.days.length - 1][0]) : ins.discoveryMonthly[ins.discoveryMonthly.length - 1]?.[0] ?? 0;
  const months = monthColumns(fromMonth, toMonth);
  const yearCols = ys.map((y) => ({ key: y.year, label: String(y.year) }));
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <div className={`insights${stale ? ' stale' : ''}`} data-testid="insights">
      {show('h-calendar') && routine && ins.days.length > 0 && (
        <section className="card" id="h-calendar">
          <h2 className="chart-title">Every day you listened</h2>
          <p className="muted small chart-sub">Daily listening, darker = more · {ins.timeZone === 'UTC' ? 'days in UTC' : `days in ${ins.timeZone}`} · music on {fmtInt(ins.daysWithMusic)} of {fmtInt(ins.totalDays)} days</p>
          <Calendar days={ins.days} theme={theme} />
        </section>
      )}
      {routine && clock && show('h-clock') && <div id="h-clock">{clock}</div>}

      <div className="insight-grid">
        {show('h-discovery') && <section className="card insight-wide" data-testid="discovery-card" id="h-discovery">
          <h2 className="chart-title">Discovering new artists</h2>
          <p className="muted small chart-sub">Artists you played for the first time ever, per month · the tallest month is highlighted</p>
          <MonthBars months={ins.discoveryMonthly} from={fromMonth} to={toMonth} theme={theme} label="New artists" fmt={(v) => fmtInt(v)} />
          <div className="grid2-inline">
            <div>
              <h4 className="sub-h">Per year · dark part = played again 6+ months after discovery</h4>
              <YearBars rows={ins.discovery.map((d) => ({ year: d.year, v: d.discovered, inner: d.stuck }))} theme={theme} fmt={(v) => fmtInt(v)} label="New artists" inner innerLabel="stuck" />
            </div>
            <div>
              <h4 className="sub-h">Notable discoveries: found that year, listened to most since</h4>
              <ul className="disc-years" data-testid="notable-discoveries">
                {ins.notableDiscoveries.filter((d) => d.artists.length).map((d) => (
                  <li key={d.year}><span className="yr">{d.year}</span>
                    {d.artists.slice(0, 4).map((a, i) => (
                      <span key={a.id}>{i > 0 && <span className="muted"> · </span>}<button type="button" className="link-like" onClick={open(a.id)}>{a.name}</button> <small className="muted">{fmtHours(a.ms)}</small></span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>}
        {show('h-variety') && <section className="card" id="h-variety">
          <h2 className="chart-title">How varied your listening was</h2>
          <p className="muted small chart-sub">“Effective artists”: you listened as if to this many artists equally (higher = more varied)</p>
          <YearBars rows={ys.map((y) => ({ year: y.year, v: y.effectiveArtists }))} theme={theme} fmt={(v) => fmtInt(Math.round(v))} label="Effective artists" />
          <p className="muted small">Top 10 artists’ share of each year: {ys.map((y) => `${y.year} ${pct(y.top10Share)}`).join(' · ')}</p>
        </section>}
        {show('h-skips') && <section className="card" id="h-skips">
          <h2 className="chart-title">Skipping</h2>
          <p className="muted small chart-sub">Share of all plays (including very short ones) that were skipped</p>
          <YearBars rows={ys.map((y) => ({ year: y.year, v: y.skipRate }))} theme={theme} fmt={pct} label="Skip rate" />
          {ins.artistSkips.length > 0 && (
            <>
              <h4 className="sub-h">Skip rate for your most-played artists</h4>
              <HBars testId="artist-skips" theme={theme} rows={ins.artistSkips.map((a) => ({ key: String(a.id), label: a.name, sub: `${fmtInt(a.plays)} plays`, value: a.skipRate, display: pct(a.skipRate), onClick: open(a.id) }))} />
            </>
          )}
          {ins.mostSkipped.length > 0 && (
            <>
              <h4 className="sub-h">Most skipped songs <span className="muted small">(10+ plays)</span></h4>
              <ol className="rank-list">{ins.mostSkipped.slice(0, 6).map((s) => (
                <li key={s.id}><span className="rank-name">{s.name}<small>{s.artist}</small></span><span className="rank-val">{pct(s.skipRate)} of {fmtInt(s.plays)} plays</span></li>
              ))}</ol>
            </>
          )}
        </section>}
        {show('h-shuffle') && <section className="card" id="h-shuffle">
          <h2 className="chart-title">Shuffle</h2>
          <p className="muted small chart-sub">Share of plays with shuffle on</p>
          <YearBars rows={ys.map((y) => ({ year: y.year, v: y.shuffleRate }))} theme={theme} fmt={pct} label="Shuffle share" />
        </section>}
        {show('h-age') && ys.some((y) => y.medianMusicAge !== null) && (
          <section className="card" id="h-age">
            <h2 className="chart-title">How old is the music you play</h2>
            <p className="muted small chart-sub">Median years between an album’s release and when you played it (albums with a known year)</p>
            <YearBars rows={ys.map((y) => ({ year: y.year, v: y.medianMusicAge }))} theme={theme} fmt={(v) => `${Math.round(v)} y`} label="Median music age" />
            <p className="muted small">New releases (released that year or the year before): {ys.filter((y) => y.newMusicShare !== null).map((y) => `${y.year} ${pct(y.newMusicShare!)}`).join(' · ')}</p>
          </section>
        )}
        {routine && show('h-sessions') && <section className="card" id="h-sessions">
          <h2 className="chart-title">Sessions</h2>
          <p className="muted small chart-sub">A session ends after 30 minutes without music</p>
          <div className="istats">
            <Stat label="Sessions" value={fmtInt(ins.sessions.count)} sub={`${ins.sessions.perWeek.toFixed(1)} per week`} />
            <Stat label="Typical length" value={`${Math.round(ins.sessions.medianMinutes)} min`} sub="median" />
            {ins.sessions.longest && <Stat label="Longest" value={`${(ins.sessions.longest.minutes / 60).toFixed(1)} h`} sub={`${new Date(ins.sessions.longest.start).toISOString().slice(0, 10)} · mostly ${ins.sessions.longest.topArtist}`} />}
          </div>
          <h4 className="sub-h">How long your sessions are</h4>
          <ColumnBars items={ins.sessionLengths.map((b) => ({ key: b.label, label: b.label, value: b.count }))} theme={theme} fmt={(v) => `${fmtInt(v)} sessions`} label="Sessions" height={90} />
          <h4 className="sub-h">When sessions start ({ins.timeZone})</h4>
          <ColumnBars items={ins.sessionStartHours.map((c, h) => ({ key: String(h), label: h % 3 === 0 ? String(h).padStart(2, '0') : '', value: c, tip: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}` }))} theme={theme} fmt={(v) => `${fmtInt(v)} sessions`} label="Sessions started" height={90} highlightMax />
        </section>}
        {routine && show('h-obsessions') && <section className="card" id="h-obsessions">
          <h2 className="chart-title">Obsessions</h2>
          <div className="istats">
            {o.longestStreak && <Stat label="Longest artist streak" value={`${o.longestStreak.days} days`} sub={`${o.longestStreak.artist}, from ${dayFmt(o.longestStreak.startDay)}`} />}
            {o.biggestTrackDay && <Stat label="Most plays of one song in a day" value={`${o.biggestTrackDay.plays}×`} sub={`${o.biggestTrackDay.track} · ${dayFmt(o.biggestTrackDay.day)} · ${o.biggestTrackDay.completed} not skipped`} />}
            {o.longestRepeat && <Stat label="Most times in a row" value={`${o.longestRepeat.count}×`} sub={`${o.longestRepeat.track} · ${o.longestRepeat.artist}`} />}
            {o.biggestArtistDay && <Stat label="Biggest day with one artist" value={fmtHours(o.biggestArtistDay.ms)} sub={`${o.biggestArtistDay.artist} · ${dayFmt(o.biggestArtistDay.day)}`} />}
          </div>
          {ins.topSongDays.length > 0 && (
            <>
              <h4 className="sub-h">Biggest single-day binges</h4>
              <HBars testId="song-binges" theme={theme} rows={ins.topSongDays.map((b, i) => ({ key: `${b.day}-${i}`, label: b.track, sub: `${b.artist} · ${dayFmt(b.day)}${b.completed < b.plays ? ` · ${b.plays - b.completed} skipped` : ''}`, value: b.plays, display: `${b.plays}×` }))} />
            </>
          )}
        </section>}
        {show('h-comebacks') && ins.comebacks.length > 0 && (
          <section className="card insight-wide" data-testid="comebacks-card" id="h-comebacks">
            <h2 className="chart-title">Comebacks</h2>
            <p className="muted small chart-sub">Artists you returned to after a year or more away · each cell is a month, darker = more listening; the empty stretch is the gap</p>
            <HeatRows testId="comeback-rows" unit="month" theme={theme} columns={months}
              rows={ins.comebacks.slice(0, 8).map((c) => ({ key: String(c.id), label: `${c.name} · ${(c.gapDays / 365).toFixed(1)} y`, cells: new Map(ins.artistMonths[c.id] ?? []), onClick: open(c.id) }))} />
          </section>
        )}
        {show('h-loyal') && <section className="card insight-wide" data-testid="loyal-card" id="h-loyal">
          <h2 className="chart-title">Most loyal</h2>
          <p className="muted small chart-sub">Artists you played in the most different years · darker = more hours that year</p>
          <HeatRows testId="loyal-rows" unit="year" theme={theme} columns={yearCols}
            rows={ins.loyal.slice(0, 10).map((l) => ({ key: String(l.id), label: `${l.name} · ${l.years} y`, cells: new Map(ins.artistYears[l.id] ?? []), onClick: open(l.id) }))} />
        </section>}
      </div>
    </div>
  );
}
