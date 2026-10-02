import { plotById } from '../report/plots';
import { useMemo, useRef, useState } from 'react';
import { METRIC_LABEL, type AggregateResult, type AggregateSettings } from '../core/aggregate';
import type { RankResult } from '../core/ranks';
import type { ClockResult } from '../core/clock';
import type { Details, Kind, Query, TableResult } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { useWidth } from './useWidth';
import { seriesColor, type Theme } from './theme';
import { Segmented } from './Controls';
import { StackedArea, type OtherMode, type Shape } from './StackedArea';
import { FlowChart } from './FlowChart';
import { ErasChart, type ErasSort } from './ErasChart';
import { BumpChart } from './BumpChart';
import { ClockChart, offsetLabel } from './ClockChart';
import { Legend } from './Legend';
import { DataTable } from './DataTable';
import { DetailsPanel } from './DetailsPanel';
import { Leaderboard } from './Leaderboard';
import { WholeAlbums } from './WholeAlbums';
import { fmtDate, fmtHours, fmtInt, fmtMetric } from './format';
import { exportPng, exportSvg, type ExportMeta, type LegendEntry } from './exporter';

export type ViewKind = 'list' | 'whole' | 'timeline' | 'eras' | 'ranks' | 'clock';
const VIEW_LABEL: Record<ViewKind, string> = { list: 'List', whole: 'Whole albums', timeline: 'Timeline', eras: 'Eras', ranks: 'Rankings', clock: 'Listening clock' };
const OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12);

export interface ChartOptions {
  style: 'stream' | 'flow';
  otherMode: OtherMode;
  shape: Shape;
  laneCount: number;
  erasSort: ErasSort;
  maxRank: number;
  /** Rankings use their own period: yearly ranks are far more stable than quarterly ones. */
  rankPer: 'year' | 'quarter' | 'month';
  /** Which measure picks the top N (and orders lists): listening time or times played. */
  rankBy: 'time' | 'plays';
  /** Listening clock: the browser's timezone (DST-aware), UTC, or a fixed offset. */
  clockZone: 'local' | 'utc' | 'fixed';
  offset: number;
}

const NOUN: Record<Kind, [string, string]> = {
  artist: ['artist', 'artists'], album: ['album', 'albums'], track: ['song', 'songs'], genre: ['genre', 'genres'], branch: ['branch', 'branches'],
};

interface Props {
  client: WorkerClient;
  theme: Theme;
  settings: AggregateSettings;
  kind: Kind;
  scope?: string | null;
  branch?: string | null;
  context?: string;
  views: ViewKind[];
  view: ViewKind;
  onView: (v: ViewKind) => void;
  /** Override the List tab label (e.g. "Top songs"). */
  listLabel?: string;
  opts: ChartOptions;
  onOpts: (o: ChartOptions) => void;
  onOpenEntity: (kind: 'artist' | 'album' | 'track', id: number) => void;
  onOpenBranch: (nodeId: string) => void;
  exportNotes: string[];
  version: number;
  /** Browser timezone, used by the listening clock by default. */
  timeZone: string;
  testId?: string;
  /** Open Share with this chart selected as a single embeddable plot. */
  onEmbed?: (plotId: string, branch?: { id: string; label: string }) => void;
}

const PLOT_SECTION: Partial<Record<Kind, string>> = { artist: 'artists', album: 'albums', track: 'songs', branch: 'genres' };

export function ExploreView(p: Props) {
  const { client, theme, settings, kind, scope, branch, view, opts } = p;
  const [one, many] = NOUN[kind];
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const flow = view === 'timeline' && opts.style === 'flow';
  const eras = view === 'eras';
  const isRanks = view === 'ranks';
  const query: Query = useMemo(() => ({
    settings: { ...(eras ? { ...settings, topN: opts.laneCount } : isRanks ? { ...settings, granularity: opts.rankPer } : settings), rankBy: opts.rankBy },
    kind, scope: scope ?? null, branch: branch ?? null,
  }), [settings, eras, isRanks, opts.laneCount, opts.rankPer, opts.rankBy, kind, scope, branch]);

  const { data, stale, error } = useWorkerQuery<unknown>(client, () => {
    if (view === 'whole') return null;
    if (view === 'list') return [{ type: 'table', query, limit: 1000 }];
    const agg = { type: 'aggregate' as const, query, maxTop: eras ? 30 : 20, colored: !eras };
    if (view === 'ranks') return [agg, { type: 'ranks', query }];
    if (view === 'clock') return [agg, { type: 'clock', query, offsetHours: opts.clockZone === 'fixed' ? opts.offset : 0, timeZone: opts.clockZone === 'local' ? p.timeZone : null }];
    return [agg];
  }, [client, query, view, opts.offset, opts.clockZone, p.timeZone, p.version]);

  const pack = data as unknown;
  const table = view === 'list' && pack && !Array.isArray(pack) && 'rows' in (pack as object) ? (pack as TableResult) : null;
  const result: AggregateResult | null = view === 'list' ? null
    : Array.isArray(pack) ? (pack[0] as AggregateResult) : pack && 'series' in (pack as object) ? (pack as AggregateResult) : null;
  const ranks = view === 'ranks' && Array.isArray(pack) ? (pack[1] as RankResult) : null;
  const clock = view === 'clock' && Array.isArray(pack) ? (pack[1] as ClockResult) : null;
  const shown = view === 'list' ? Boolean(table) : Boolean(result && result.periods.length && (view !== 'ranks' || ranks) && (view !== 'clock' || clock));

  const usesOther = view === 'timeline';
  const other = result?.series.find((s) => s.kind === 'other');
  const otherShare = other && result?.included.ms ? (other.totalMs / result.included.ms) * 100 : 0;
  const n = result?.topIds.length ?? settings.topN;
  const gran = isRanks ? opts.rankPer : settings.granularity;
  const rangeLabel = result?.periods.length ? `${result.periods[0].label} – ${result.periods[result.periods.length - 1].label}` : '';
  const ctx = p.context ? `${p.context}: ` : '';
  const zoneLabel = opts.clockZone === 'local' ? `your timezone (${p.timeZone})` : opts.clockZone === 'utc' ? 'UTC' : offsetLabel(opts.offset);
  const topNoun = n === 1 ? `top ${one}` : `top ${n} ${many}`;
  /** For albums a "play" is an album listen (a sitting with 3+ different tracks), not a track play. */
  const playsLabel = kind === 'album' ? 'Album listens' : 'Times played';
  const measureLabel = kind === 'album' && settings.metric === 'plays' ? 'Album listens' : METRIC_LABEL[settings.metric];
  const byLabel = opts.rankBy === 'plays' ? playsLabel.toLowerCase() : 'listening time';

  const titles: Record<ViewKind, string> = {
    list: `${ctx}${p.listLabel ?? `top ${many}`}`,
    whole: `${ctx}whole albums, front to back`,
    timeline: flow ? `${ctx}how the ${topNoun} rose and fell` : `${ctx}${topNoun} over time`,
    eras: `${ctx}${many} by era`,
    ranks: `${ctx}how the ${topNoun} ranked`,
    clock: `${ctx}when you listen`,
  };
  const title = titles[view].replace(/^./, (c) => c.toUpperCase());
  const subtitle: Record<ViewKind, string> = {
    list: 'Ranked over the selected date range',
    whole: 'Albums you played (almost) all the way through in one sitting',
    timeline: `${measureLabel} per ${gran} · top by ${byLabel} · ${rangeLabel}`,
    eras: `Top ${opts.laneCount} by ${byLabel}, one lane each, ordered by ${opts.erasSort === 'peak' ? 'when each peaked' : 'total'} · ${rangeLabel}`,
    ranks: `Rank each ${gran} by ${byLabel} · ${rangeLabel}`,
    clock: `Weekday × hour, ${zoneLabel} · ${rangeLabel}`,
  };
  const about: Record<ViewKind, string> = {
    whole: '',
    list: kind === 'album'
      ? `An album listen is a sitting (no gap over 30 min) in which you played at least 3 different tracks of the album. Track plays are shown underneath.`
      : `Times played counts plays of at least ${settings.minMs / 1000} s.`,
    timeline: flow
      ? `Each column is one UTC ${gran}. A ribbon joins the same ${one} in neighbouring periods; it does not show listening moving between ${many}.`
      : `Top ${many} are chosen once across the whole range. Periods are UTC; empty periods are marked.`,
    eras: `All lanes share one scale; distinct peaks are labelled.${other ? ` ${fmtInt(other.memberCount)} smaller ${many} (${otherShare.toFixed(1)}%) are not shown.` : ''}`,
    ranks: `Rank among all ${many}${scope ? ' in this branch' : ''} with plays that ${gran}. A line fades out when it drops below #${opts.maxRank} and returns when it comes back.`,
    clock: opts.clockZone === 'local'
      ? `Spotify records UTC; times are converted to ${p.timeZone} with daylight saving, assuming you listened there.`
      : opts.clockZone === 'utc' ? 'Shown in UTC, as Spotify records it.' : `Shifted by a fixed ${offsetLabel(opts.offset)} (no daylight saving).`,
  };

  const select = (seriesKey: string, periodIndex: number | null) => {
    const s = result?.series.find((x) => x.key === seriesKey);
    if (s && s.kind === 'item' && s.id !== null) {
      if (kind === 'artist' || kind === 'album' || kind === 'track') return p.onOpenEntity(kind, s.id);
      if (kind === 'branch' && s.ref) return p.onOpenBranch(s.ref);
      if (kind === 'genre') return p.onOpenBranch(`g:${s.label.toLowerCase()}`);
    }
    client.request<Details>({ type: 'details', query, seriesKey, periodIndex }).then(setDetails).catch(() => setDetails(null));
  };

  const legendEntries = (): LegendEntry[] => {
    if (!result || view === 'eras' || view === 'clock' || view === 'list') return [];
    const total = result.included.ms;
    return [...result.series].reverse()
      .filter((s) => (view === 'ranks' ? s.kind === 'item' : !(s.kind === 'other' && opts.otherMode === 'hidden')))
      .map((s) => ({
        label: s.kind === 'other' ? `${s.label} (${s.memberCount})` : s.label,
        color: seriesColor(s, theme),
        hatched: s.kind === 'unclassified',
        value: settings.metric === 'plays' ? `${fmtMetric(s.totalPlays, 'plays')} plays` : settings.metric === 'share' ? fmtMetric(total ? (s.totalMs / total) * 100 : 0, 'share') : fmtHours(s.totalMs),
      }));
  };

  const doExport = async (fmt: 'svg' | 'png') => {
    setExportError(null);
    const svg = svgRef.current;
    if (!result || !svg) return;
    const meta: ExportMeta = {
      title: title.replace(/^Top/, 'My top').replace(/^When you/, 'When I'),
      subtitle: [
        `${subtitle[view]} (UTC)`,
        `Filters: plays of at least ${settings.minMs / 1000} s · top ${many} by ${byLabel}${usesOther ? ` · other ${many} ${opts.otherMode === 'below' ? 'shown below the line' : `not drawn (${otherShare.toFixed(0)}%)`}` : ''}${p.context ? ` · scope: ${p.context}` : ''}`,
      ],
      legend: legendEntries(),
      footer: [
        `Actual data coverage: ${result.coverage ? `${fmtDate(result.coverage.first)} to ${fmtDate(result.coverage.last)} UTC` : 'none'} · ${fmtInt(result.included.count)} music plays · ${fmtHours(result.included.ms)}. Excluded: ${fmtInt(result.belowThreshold.count)} plays under ${settings.minMs / 1000} s; podcasts and audiobooks not counted.`,
        about[view],
        ...p.exportNotes,
      ],
      theme,
      filename: `listening-${kind}-${flow ? 'flow' : view}-${gran}-${settings.metric}`,
    };
    try {
      if (fmt === 'svg') exportSvg(svg, meta);
      else await exportPng(svg, meta);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const highlight = hoverKey ?? pinned;
  const rankResult = result ? { ...result, series: result.series.filter((s) => s.kind === 'item') } : null;
  const hasOptions = view !== 'list' && view !== 'whole';

  // Only unscoped charts can be embedded on their own (a single-plot file has no branch scope).
  const embedId = !p.scope && (p.kind === 'branch' || !p.branch || p.branch === 'root') && PLOT_SECTION[p.kind] && plotById(`${PLOT_SECTION[p.kind]}-${view}`) ? `${PLOT_SECTION[p.kind]}-${view}` : null;
  return (
    <section className="card chart-card" data-testid={p.testId}>
      {p.views.length > 1 && (
        <div className="tabs" role="tablist" aria-label="View">
          {p.views.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => p.onView(v)}>
              {v === 'list' && p.listLabel ? p.listLabel : VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      )}
      <header className="chart-head">
        <div>
          <h2 className="chart-title" data-testid="chart-title">{title}</h2>
          <p className="muted small chart-sub">{subtitle[view]}</p>
        </div>
        <div className="chart-actions">
          {view !== 'clock' && view !== 'whole' && kind !== 'branch' && kind !== 'genre' && (
            <Segmented<'time' | 'plays'> label="Top by" value={opts.rankBy} onChange={(v) => p.onOpts({ ...opts, rankBy: v })}
              options={[['time', 'Listening time'], ['plays', playsLabel]]} />
          )}
          {view === 'timeline' && (
            <Segmented<'stream' | 'flow'> label="Show as" value={opts.style} onChange={(v) => p.onOpts({ ...opts, style: v })} options={[['stream', 'Stream'], ['flow', 'Flow']]} />
          )}
          {hasOptions && (
            <details className="menu">
              <summary className="btn ghost">Options</summary>
              <div className="menu-panel" role="group" aria-label="Chart options">
                {usesOther && (
                  <Segmented<OtherMode> label={`Other ${many}`} value={opts.otherMode} onChange={(v) => p.onOpts({ ...opts, otherMode: v })}
                    options={[['below', 'Below axis'], ['hidden', 'Hide']]} />
                )}
                {view === 'timeline' && !flow && <Segmented<Shape> label="Shape" value={opts.shape} onChange={(v) => p.onOpts({ ...opts, shape: v })} options={[['smooth', 'Smooth'], ['steps', 'Steps']]} />}
                {view === 'eras' && (
                  <>
                    <label className="control"><span className="control-label">Lanes</span>
                      <select value={opts.laneCount} aria-label="Number of lanes" onChange={(e) => p.onOpts({ ...opts, laneCount: Number(e.target.value) })}>
                        {[10, 15, 20, 25, 30].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                    <Segmented<ErasSort> label="Order" value={opts.erasSort} onChange={(v) => p.onOpts({ ...opts, erasSort: v })} options={[['peak', 'By peak'], ['total', 'By total']]} />
                  </>
                )}
                {view === 'ranks' && (
                  <Segmented<'year' | 'quarter' | 'month'> label="Rank per" value={opts.rankPer} onChange={(v) => p.onOpts({ ...opts, rankPer: v })}
                    options={[['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month']]} />
                )}
                {view === 'ranks' && (
                  <label className="control"><span className="control-label">Show ranks</span>
                    <select value={opts.maxRank} aria-label="Ranks shown" onChange={(e) => p.onOpts({ ...opts, maxRank: Number(e.target.value) })}>
                      {[5, 10, 15, 20].map((v) => <option key={v} value={v}>1 to {v}</option>)}
                    </select>
                  </label>
                )}
                {view === 'clock' && (
                  <label className="control"><span className="control-label">Time shown as</span>
                    <select value={opts.clockZone === 'fixed' ? String(opts.offset) : opts.clockZone} aria-label="Time offset"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'local' || v === 'utc') p.onOpts({ ...opts, clockZone: v });
                        else p.onOpts({ ...opts, clockZone: 'fixed', offset: Number(v) });
                      }}>
                      <option value="local">Your timezone ({p.timeZone})</option>
                      <option value="utc">UTC (as recorded)</option>
                      {OFFSETS.filter((o) => o !== 0).map((o) => <option key={o} value={o}>{offsetLabel(o)} fixed</option>)}
                    </select>
                  </label>
                )}
                {view !== 'clock' && (
                  <label className="check"><input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> Show data table</label>
                )}
              </div>
            </details>
          )}
          {p.onEmbed && embedId && (
            <button type="button" className="btn ghost" onClick={() => p.onEmbed!(embedId, p.kind === 'branch' && p.branch && p.branch !== 'root' ? { id: p.branch, label: p.context ?? p.branch } : undefined)} title="Export this chart on its own, interactive, for a blog post">Embed</button>
          )}
          {hasOptions && (
            <details className="menu">
              <summary className="btn ghost">Export</summary>
              <div className="menu-panel menu-right">
                <button type="button" className="btn" onClick={() => doExport('png')} disabled={!shown}>Export PNG</button>
                <button type="button" className="btn" onClick={() => doExport('svg')} disabled={!shown}>Export SVG</button>
              </div>
            </details>
          )}
        </div>
      </header>

      {result && view !== 'list' && (
        <details className="about">
          <summary>
            {fmtInt(result.included.count)} plays · {fmtHours(result.included.ms)}
            {usesOther && other && opts.otherMode === 'below' && <> · {fmtInt(other.memberCount)} other {other.memberCount === 1 ? one : many} below the line ({otherShare.toFixed(0)}%)</>}
            {usesOther && other && opts.otherMode === 'hidden' && <> · {fmtInt(other.memberCount)} other {many} hidden ({otherShare.toFixed(0)}%)</>}
            <span className="about-link">About these numbers</span>
          </summary>
          <p className="filter-impact" data-testid="filter-impact">
            Showing <b>{fmtInt(result.included.count)}</b> plays · <b>{fmtHours(result.included.ms)}</b>
            {result.coverage && <> · actual coverage {fmtDate(result.coverage.first)} to {fmtDate(result.coverage.last)} UTC</>}.
            {' '}Excluded: <b>{fmtInt(result.belowThreshold.count)}</b> plays ({fmtHours(result.belowThreshold.ms)}) shorter than {settings.minMs / 1000} s
            {result.outsideRange.count > 0 && <>; <b>{fmtInt(result.outsideRange.count)}</b> plays ({fmtHours(result.outsideRange.ms)}) outside the date range</>}
            {scope && <>; only listening in this branch (artists with several genres count in part)</>}.
          </p>
          {usesOther && other && (
            <p data-testid="other-note">
              {opts.otherMode === 'below'
                ? <>Below the line: {fmtInt(other.memberCount)} other {other.memberCount === 1 ? one : many}, {fmtHours(other.totalMs)} ({otherShare.toFixed(1)}% of listening in range), on the same scale as the top {n} above it.</>
                : <>Not drawn: {fmtInt(other.memberCount)} other {other.memberCount === 1 ? one : many}, {fmtHours(other.totalMs)} ({otherShare.toFixed(1)}% of listening in range). The axis shows only the top {n}.</>}
            </p>
          )}
          <p className="chart-note">{about[view]}</p>
        </details>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div ref={chartRef} className={`chart-area${stale ? ' stale' : ''}`}>
        {view === 'whole' ? (
          <WholeAlbums client={client} theme={theme} settings={settings} scope={scope ?? null} version={p.version} onOpenAlbum={(id) => p.onOpenEntity('album', id)} />
        ) : !shown ? (
          result && !result.periods.length ? <p className="muted">No plays match the current filters.</p> : <p className="muted">Preparing…</p>
        ) : view === 'list' ? (
          <Leaderboard kind={kind} table={table!} minSeconds={settings.minMs / 1000} by={opts.rankBy} onOpen={(id, row) => {
            if (kind === 'artist' || kind === 'album' || kind === 'track') p.onOpenEntity(kind, id);
            else p.onOpenBranch(`g:${row.name.toLowerCase()}`);
          }} />
        ) : flow ? (
          <FlowChart ref={svgRef} result={result!} metric={settings.metric} otherMode={opts.otherMode} width={width} theme={theme} highlight={highlight} onSelect={select} />
        ) : view === 'eras' ? (
          <ErasChart ref={svgRef} result={result!} metric={settings.metric} sort={opts.erasSort} width={width} theme={theme} onSelect={select} />
        ) : view === 'ranks' ? (
          <BumpChart ref={svgRef} result={result!} ranks={ranks!} metric={settings.metric} maxRank={opts.maxRank} width={width} theme={theme} highlight={highlight} onSelect={select} />
        ) : view === 'clock' ? (
          <ClockChart ref={svgRef} clock={clock!} width={width} theme={theme} />
        ) : (
          <StackedArea ref={svgRef} result={result!} metric={settings.metric} shape={opts.shape} otherMode={opts.otherMode} width={width} theme={theme} highlight={highlight} onSelect={select} />
        )}
      </div>
      {shown && (view === 'timeline' || view === 'ranks') && (
        <Legend
          result={view === 'ranks' ? rankResult! : result!}
          metric={settings.metric}
          theme={theme}
          pinned={pinned}
          otherMode={opts.otherMode}
          onHover={setHoverKey}
          onTogglePin={(k) => setPinned((x) => (x === k ? null : k))}
        />
      )}
      {exportError && <p className="error-text" role="alert">{exportError}</p>}
      {shown && showTable && result && view !== 'clock' && <DataTable result={result} metric={settings.metric} />}
      {details && <DetailsPanel details={details} onClose={() => setDetails(null)} />}
    </section>
  );
}
