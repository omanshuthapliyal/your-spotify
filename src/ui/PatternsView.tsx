import { useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { Era, LifeKind, Patterns, SurvivalPoint, Taste } from '../core/patterns';
import { LIFE_KINDS } from '../core/patterns';
import { monthLabel } from '../core/patterns/monthly';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { useWidth } from './useWidth';
import type { Theme } from './theme';
import { fmtHours, fmtInt } from './format';
import { StackedArea } from './StackedArea';
import { Legend } from './Legend';
import { ColistenExplorer } from './ColistenExplorer';

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const pct = (v: number) => `${Math.round(v * 100)}%`;
const span = (a: number, b: number) => (a === b ? monthLabel(a) : `${monthLabel(a)} – ${monthLabel(b)}`);
const months = (e: Era) => e.toMonth - e.fromMonth + 1;

/** Section index for the Patterns sub-nav (id, label). */
export const PATTERN_SECTIONS: Array<[string, string]> = [['p-map', 'Who you play together'], ['p-eras', 'Eras'], ['p-tastes', 'Tastes'], ['p-life', 'Lifecycles']];

export const LIFE_INFO: Record<LifeKind, [string, string]> = {
  evergreen: ['Evergreen', 'Played across 2+ years, in at least half the months, never concentrated in one burst, and still played.'],
  slowburn: ['Slow burn', 'Grew on you: the busiest stretch came a year or more after discovery, at 4× the early rate or more.'],
  flash: ['Flash', 'Most of the listening (65%+) happened within 3 months.'],
  seasonal: ['Seasonal', 'Returns at the same time of year: 75%+ of listening in the same 3 calendar months, across 2+ years.'],
  steady: ['Steady', 'Still played, without a strong burst or growth pattern.'],
  faded: ['Faded', 'Not played in the last 6 months of the range, and no other pattern fits.'],
  new: ['New', 'First played in the last 6 months; too early to tell.'],
};

function stabilityLabel(s: number): [string, string] {
  if (s >= 0.85) return ['stable', 'Found the same way from every random start'];
  if (s >= 0.65) return ['fairly stable', 'Mostly the same artists from every random start'];
  return ['loose', 'Changes between random starts: this group of artists can be split more than one way'];
}

/** One band per era, widths proportional to time; the strongest artist is written in when it fits. */
function EraBand({ eras, theme, height = 46, selected, onSelect }: {
  eras: Era[]; theme: Theme; height?: number; selected?: number | null; onSelect?: (i: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!eras.length) return null;
  const first = eras[0].fromMonth;
  const total = eras[eras.length - 1].toMonth - first + 1;
  const x = (m: number) => ((m - first) / total) * width;
  const years: number[] = [];
  for (let y = Math.ceil(first / 12); y * 12 <= first + total - 1; y++) years.push(y);
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={width} height={height + 22} role="img" fontFamily={FONT}
        aria-label={`Listening eras: ${eras.map((e) => `${span(e.fromMonth, e.toMonth)}, ${e.top[0]?.name ?? ''}`).join('; ')}`}>
        {eras.map((e, i) => {
          const x0 = x(e.fromMonth), w = Math.max(1, x(e.toMonth + 1) - x0 - 2);
          const fill = theme.series[8 + (i % 8)];
          const label = e.top[0]?.name ?? '';
          const fits = w > label.length * 6.4 + 12;
          return (
            <g key={i} data-era={i} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(i)}>
              <rect x={x0 + 1} y={2} width={w} height={height - 4} rx={6} fill={fill}
                stroke={selected === i ? theme.ink : 'none'} strokeWidth={2} opacity={selected != null && selected !== i ? 0.55 : 1}>
                <title>{`Era ${i + 1}: ${span(e.fromMonth, e.toMonth)} · ${e.top.slice(0, 3).map((a) => a.name).join(', ')}`}</title>
              </rect>
              {fits && <text x={x0 + 9} y={height / 2 + 1} dy="0.35em" fontSize={12} fontWeight={600} fill="#111" pointerEvents="none">{label}</text>}
              {!fits && w > 18 && <text x={x0 + 1 + w / 2} y={height / 2 + 1} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={600} fill="#111" pointerEvents="none">{i + 1}</text>}
            </g>
          );
        })}
        {years.map((y) => (
          <g key={y}>
            <line x1={x(y * 12)} x2={x(y * 12)} y1={height} y2={height + 5} stroke={theme.axis} />
            {(total / 12) * 34 < width || y % 2 === 0 ? <text x={x(y * 12) + 3} y={height + 17} fontSize={10.5} fill={theme.muted}>{y}</text> : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function EraCard({ e, i, onOpenArtist }: { e: Era; i: number; onOpenArtist?: (id: number) => void }) {
  const open = (id: number) => (onOpenArtist ? () => onOpenArtist(id) : undefined);
  return (
    <li className="era-card" data-testid="era-card">
      <div className="era-head">
        <b>Era {i + 1}</b> <span>{span(e.fromMonth, e.toMonth)}</span>
        <span className="muted small"> · {months(e)} month{months(e) === 1 ? '' : 's'} · {fmtHours(e.ms)}</span>
      </div>
      <p className="era-top">
        {e.top.slice(0, 3).map((a, k) => (
          <span key={a.id}>{k > 0 && <span className="muted"> · </span>}<button type="button" className="link-like" onClick={open(a.id)}>{a.name}</button> <small className="muted">{pct(a.share)}</small></span>
        ))}
      </p>
      {e.defining.length > 0 && (
        <p className="small"><span className="muted">Defining: </span>{e.defining.map((d) => `${d.name} (${d.lift! >= 50 ? '50+' : Math.round(d.lift!)}× its usual share)`).join(', ')}</p>
      )}
      <p className="muted small">
        {e.genre ? `Top genre ${e.genre.name} (${pct(e.genre.share)} of classified listening). ` : ''}
        {e.shift !== null ? `Mix changed ${pct(e.shift)} from the previous era. ` : ''}
        {e.startWindow && e.startWindow.from !== e.startWindow.to ? `Start could sit anywhere ${monthLabel(e.startWindow.from)} – ${monthLabel(e.startWindow.to)}.` : ''}
      </p>
    </li>
  );
}

function TasteCard({ t, theme, onOpenArtist }: { t: Taste; theme: Theme; onOpenArtist?: (id: number) => void }) {
  const [label, tip] = stabilityLabel(t.stability);
  return (
    <li className="taste-card" data-testid="taste-card">
      <div className="era-head">
        <span className="swatch" style={{ background: theme.series[t.index] }} />
        <b>Taste {t.index + 1}</b>
        <span className="muted small"> · {pct(t.share)} of listening{t.peak ? ` · peak ${t.peak}` : ''}</span>
        <span className={`chip stab stab-${label.split(' ')[0]}`} title={`${tip} (match ${t.stability.toFixed(2)})`}>{label}</span>
      </div>
      <p className="small">
        {t.artists.map((a, k) => (
          <span key={a.id}>{k > 0 && <span className="muted"> · </span>}<button type="button" className="link-like" onClick={onOpenArtist ? () => onOpenArtist(a.id) : undefined}>{a.name}</button></span>
        ))}
      </p>
    </li>
  );
}

function Spark({ values, theme, width = 220, height = 26 }: { values: number[]; theme: Theme; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const bw = width / Math.max(1, values.length);
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      {values.map((v, i) => v > 0 ? <rect key={i} x={i * bw} y={height - (v / max) * height} width={Math.max(0.8, bw - 0.4)} height={Math.max(1, (v / max) * height)} fill={theme.series[0]} /> : null)}
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={theme.axis} />
    </svg>
  );
}

function SurvivalChart({ curve, halfLife, theme }: { curve: SurvivalPoint[]; halfLife: number | null; theme: Theme }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 170, L = 40, B = 26, T = 8;
  const tMax = Math.min(96, Math.max(12, Math.ceil((curve[curve.length - 1]?.t ?? 12) / 12) * 12));
  const x = (t: number) => L + (Math.min(t, tMax) / tMax) * (width - L - 10);
  const y = (s: number) => T + (1 - s) * (H - T - B);
  let d = `M${x(0)},${y(1)}`;
  let prev = 1;
  for (const p of curve.slice(1)) { if (p.t > tMax) break; d += `H${x(p.t)}V${y(p.s)}`; prev = p.s; }
  d += `H${x(tMax)}`;
  void prev;
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={width} height={H} role="img" fontFamily={FONT} aria-label={`Share of new artists still being played, by months since discovery${halfLife !== null ? `; half stopped by ${halfLife.toFixed(0)} months` : ''}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((s) => (
          <g key={s}><line x1={L} x2={width - 10} y1={y(s)} y2={y(s)} stroke={theme.grid} /><text x={L - 6} y={y(s)} dy="0.35em" textAnchor="end" fontSize={10.5} fill={theme.muted}>{s * 100}%</text></g>
        ))}
        {Array.from({ length: tMax / 12 + 1 }, (_, k) => k * 12).map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={10.5} fill={theme.muted}>{t === 0 ? 'first play' : `${t / 12} yr`}</text>
        ))}
        <path d={d} fill="none" stroke={theme.series[0]} strokeWidth={2.2} />
        {halfLife !== null && halfLife <= tMax && (
          <g><line x1={x(halfLife)} x2={x(halfLife)} y1={y(0.5)} y2={H - B} stroke={theme.series[1]} strokeDasharray="3 3" />
            <circle cx={x(halfLife)} cy={y(0.5)} r={4} fill={theme.series[1]} />
            <text x={x(halfLife) + 7} y={y(0.5) - 7} fontSize={11.5} fill={theme.ink}>half stopped by {halfLife.toFixed(0)} months</text></g>
        )}
      </svg>
    </div>
  );
}

function Lifecycles({ life, theme, onOpenArtist }: { life: Patterns['life']; theme: Theme; onOpenArtist?: (id: number) => void }) {
  const kinds = LIFE_KINDS.filter((k) => life.counts[k] > 0);
  const [kind, setKind] = useState<LifeKind>(kinds.includes('evergreen') ? 'evergreen' : kinds[0] ?? 'steady');
  const rows = life.artists.filter((a) => a.kind === kind && life.series[a.id]).slice(0, 8);
  const s = life.survival;
  return (
    <div className="grid2-inline">
      <div>
        <div className="kind-chips" role="tablist" aria-label="Lifecycle">
          {kinds.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={`chip chip-btn${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              {LIFE_INFO[k][0]} <span className="muted">{life.counts[k]}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{LIFE_INFO[kind][1]}</p>
        <ol className="life-rows" data-testid="life-rows">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" className="link-like life-name" onClick={onOpenArtist ? () => onOpenArtist(a.id) : undefined}>{a.name}</button>
              <Spark values={life.series[a.id]} theme={theme} />
              <span className="muted small">{fmtHours(a.ms)} · {monthLabel(a.firstMonth)}{a.lastMonth !== a.firstMonth ? ` – ${monthLabel(a.lastMonth)}` : ''}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">Bars: monthly listening, {monthLabel(life.firstMonth)} – {monthLabel(life.firstMonth + life.months - 1)}. Artists with 2+ hours and 10+ plays.</p>
      </div>
      <div data-testid="survival">
        <h4 className="sub-h">How long new artists last</h4>
        <SurvivalChart curve={s.curve} halfLife={s.halfLife} theme={theme} />
        <p className="small">
          {s.halfLife !== null ? <>Half of the artists you discovered had stopped being played within <b>{s.halfLife.toFixed(0)} months</b>. </> : <>More than half of the artists you discovered are still being played. </>}
          {pct(s.afterYear)} were still being played a year after the first play.
        </p>
        <p className="muted small">
          Kaplan-Meier estimate over {fmtInt(s.artists)} artists first played 3+ months into the range and on 2+ different days ({fmtInt(s.singleDay)} one-day tries left out).
          “Stopped” means no plays in the last 6 months; artists still going count as lasting at least as long as so far.
        </p>
      </div>
    </div>
  );
}

/** Pure display of the pattern models (also used by the share report). */
export type PatternPlot = 'map' | 'eras' | 'tastes' | 'life';

/** Section heading with an optional "Embed" button (opens Share with this plot selected). */
function SecHead({ title, plot, onEmbed }: { title: string; plot: string; onEmbed?: (plot: string) => void }) {
  return (
    <div className="sec-head">
      <h2 className="chart-title">{title}</h2>
      {onEmbed && <button type="button" className="btn ghost btn-small" onClick={() => onEmbed(plot)} aria-label={`Embed “${title}” in a blog post`}>Embed</button>}
    </div>
  );
}

export function PatternsBody({ p, theme, onOpenArtist, k, onK, mapSize, onMapSize, stale = false, only, onEmbed }: {
  p: Partial<Patterns>; theme: Theme; onOpenArtist?: (id: number) => void; k?: number; onK?: (k: number) => void;
  mapSize?: number; onMapSize?: (n: number) => void; stale?: boolean;
  /** Render one section only (single-plot embeds). */
  only?: PatternPlot;
  onEmbed?: (plot: string) => void;
}) {
  const show = (x: PatternPlot) => !only || only === x;
  const [era, setEra] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [tref, twidth] = useWidth<HTMLDivElement>();
  const e = p.eras;
  const t = p.tastes;
  const shownEras = !e ? [] : era === null ? e.eras : [e.eras[era]];
  return (
    <div className={`insights patterns${stale ? ' stale' : ''}`} data-testid="patterns">
      {show('map') && p.map && <section className="card map-hero" id="p-map" data-testid="map-card">
        <SecHead title="Who you play together" plot="map" onEmbed={onEmbed} />
        <p className="muted small chart-sub">Your top {p.map.nodes.length} artists, linked when you play them in the same listening sessions. Colours are groups of artists that keep showing up together; outlines mark each group. Bigger circles = more listening.</p>
        {p.map.nodes.length > 2 ? <ColistenExplorer map={p.map} theme={theme} onOpenArtist={onOpenArtist} mapSize={mapSize} onMapSize={onMapSize} /> : <p className="muted">Not enough sessions to map.</p>}
        <p className="muted small">
          {fmtInt(p.map.sessions)} sessions (no gap over 30 minutes). Link strength: sessions with both artists relative to each artist's sessions (Ochiai); each artist links to its 5 strongest partners.
          Groups: Louvain communities; group stability {p.map.stability.toFixed(2)} (adjusted Rand index across runs, 1 = identical). Bridges link into several groups. Groups are drawn as islands, related groups side by side: only links and groups carry meaning, not exact distances.
        </p>
      </section>}

      {show('eras') && e && <section className="card" id="p-eras" data-testid="eras">
        <SecHead title="Your listening eras" plot="eras" onEmbed={onEmbed} />
        <p className="muted small chart-sub">
          Stretches of time with a distinct artist mix, found automatically. A boundary is kept only if it beats what the same method finds in your months shuffled at random.
        </p>
        {e.eras.length ? (
          <>
            <EraBand eras={e.eras} theme={theme} selected={era} onSelect={(i) => setEra(era === i ? null : i)} />
            <ol className="era-cards">{shownEras.map((x) => <EraCard key={x.fromMonth} e={x} i={e.eras.indexOf(x)} onOpenArtist={onOpenArtist} />)}</ol>
            {era !== null && <button type="button" className="link" onClick={() => setEra(null)}>Show all eras</button>}
            <p className="muted small">{e.eras.length} era{e.eras.length === 1 ? '' : 's'} (at most 10, each 3+ months) from {fmtInt(e.fittedMonths)} months{e.sparseMonths ? `; ${e.sparseMonths} sparse months join the era around them` : ''}. They account for {pct(e.explained)} of the month-to-month variation in your artist mix.</p>
          </>
        ) : <p className="muted">Not enough months with listening to find eras.</p>}
      </section>}

      {show('tastes') && t !== undefined && <section className="card" id="p-tastes" data-testid="tastes">
        <header className="chart-head">
          <div>
            <h2 className="chart-title">Your tastes over time</h2>
            <p className="muted small chart-sub">Groups of artists you tend to play in the same months, learned from your history (no genre labels needed), named by their top artists</p>
          </div>
          {onK && k !== undefined && (
            <label className="control"><span className="control-label">Tastes</span>
              <select value={k} onChange={(ev) => onK(Number(ev.target.value))} aria-label="Number of tastes">
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></label>
          )}
          {onEmbed && <button type="button" className="btn ghost btn-small" onClick={() => onEmbed('tastes')} aria-label="Embed “Your tastes over time” in a blog post">Embed</button>}
        </header>
        {t ? (
          <>
            <div ref={tref} className="chart-area">
              <StackedArea result={t.result} metric="hours" shape="smooth" otherMode="below" width={twidth} theme={theme} highlight={pinned ?? hover} onSelect={() => undefined} />
            </div>
            <Legend result={t.result} metric="hours" theme={theme} pinned={pinned} otherMode="below" onHover={setHover} onTogglePin={(key) => setPinned(pinned === key ? null : key)} />
            <ol className="taste-cards">{t.tastes.map((x) => <TasteCard key={x.index} t={x} theme={theme} onOpenArtist={onOpenArtist} />)}</ol>
            <p className="muted small">
              Non-negative matrix factorisation (a topic model) of your top {t.artists} artists over {t.fittedMonths} months; they cover {pct(t.modelledShare)} of your listening, the rest is below the line.
              Each play's hours are split across tastes, so the bands add up to your real listening. Stability compares five fits from different random starts.
            </p>
          </>
        ) : <p className="muted">Not enough listening to learn tastes.</p>}
      </section>}

      {show('life') && p.life && <section className="card" id="p-life" data-testid="life-card">
        <SecHead title="How artists come and go" plot="life" onEmbed={onEmbed} />
        <p className="muted small chart-sub">The shape of your history with each artist, by simple rules you can check, and how long newly found artists stay in rotation</p>
        <Lifecycles life={p.life} theme={theme} onOpenArtist={onOpenArtist} />
      </section>}
    </div>
  );
}

export function PatternsView({ client, theme, settings, version, onOpenArtist, onEmbed }: {
  client: WorkerClient; theme: Theme; settings: AggregateSettings; version: number; onOpenArtist: (id: number) => void; onEmbed?: (plot: string) => void;
}) {
  const [k, setK] = useState(6);
  const [mapSize, setMapSize] = useState(150);
  const { data, stale } = useWorkerQuery<Patterns>(client, () => [{ type: 'patterns', settings, k, mapSize }], [client, settings, k, mapSize, version]);
  if (!data) return <section className="card"><p className="muted">Finding your eras, tastes and patterns…</p></section>;
  return <PatternsBody p={data} theme={theme} onOpenArtist={onOpenArtist} k={k} onK={setK} mapSize={mapSize} onMapSize={setMapSize} stale={stale} onEmbed={onEmbed} />;
}

/** Compact era strip for the Story page. */
export function StoryEras({ client, theme, settings, version, onMore }: {
  client: WorkerClient; theme: Theme; settings: AggregateSettings; version: number; onMore: () => void;
}) {
  const { data } = useWorkerQuery<Patterns>(client, () => [{ type: 'patterns', settings, tastes: false }], [client, settings, version]);
  if (!data || data.eras.eras.length < 2) return null;
  const eras = data.eras.eras;
  return (
    <section className="card" data-testid="story-eras">
      <header className="chart-head">
        <div>
          <h2 className="chart-title">Your eras</h2>
          <p className="muted small chart-sub">{eras.length} distinct stretches, found from how your artist mix changed</p>
        </div>
        <button type="button" className="btn" onClick={onMore}>Explore patterns</button>
      </header>
      <EraBand eras={eras} theme={theme} />
      <ol className="era-mini">
        {eras.map((e, i) => <li key={i}><span className="swatch" style={{ background: theme.series[8 + (i % 8)] }} /> <b>{span(e.fromMonth, e.toMonth)}</b> {e.top.slice(0, 2).map((a) => a.name).join(', ')}</li>)}
      </ol>
    </section>
  );
}
