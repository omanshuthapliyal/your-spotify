/**
 * Viewer for the shareable report. Built into a single inline script (vite.report.config.ts) and
 * embedded in the exported HTML with its data. It renders the same charts as the app from saved
 * summary statistics; it has no access to any listening history and makes no network requests.
 *
 * URL hash: #albums opens a section; add &embed (e.g. #albums&embed) to hide the header and
 * section tabs for embedding one section in a blog post.
 */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReportData, KindBlock } from './types';
import { useTheme, type ThemePref } from '../ui/theme';
import { useWidth } from '../ui/useWidth';
import { Segmented } from '../ui/Controls';
import { StackedArea } from '../ui/StackedArea';
import { FlowChart } from '../ui/FlowChart';
import { ErasChart } from '../ui/ErasChart';
import { BumpChart } from '../ui/BumpChart';
import { Legend } from '../ui/Legend';
import { Leaderboard } from '../ui/Leaderboard';
import { StoryBody } from '../ui/Story';
import { TopListCard } from '../ui/Overview';
import { WholeAlbumsBody } from '../ui/WholeAlbums';
import { InsightsBody } from '../ui/InsightsView';
import { PatternsBody } from '../ui/PatternsView';
import '../styles.css';
import './report.css';

type Tab = 'story' | 'artists' | 'albums' | 'songs' | 'genres' | 'habits' | 'patterns';
const TAB_LABEL: Record<Tab, string> = { story: 'Story', artists: 'Artists', albums: 'Albums', songs: 'Songs', genres: 'Genres', habits: 'Habits', patterns: 'Patterns' };
const DAY = 86_400_000;

function readHash(tabs: Tab[]): { tab: Tab; embed: boolean } {
  const parts = window.location.hash.replace(/^#/, '').split('&');
  const tab = (tabs.find((t) => t === parts[0]) ?? tabs[0]) as Tab;
  return { tab, embed: parts.includes('embed') || new URLSearchParams(window.location.search).has('embed') };
}

function KindPanel({ block, kind, theme, whole, dateFmt }: {
  block: KindBlock; kind: 'artist' | 'album' | 'track'; theme: ReturnType<typeof useTheme>;
  whole?: NonNullable<ReportData['albums']>['whole']; dateFmt: (t: number) => string;
}) {
  const views: Array<[string, string]> = [['list', kind === 'track' ? 'Top songs' : kind === 'album' ? 'Top albums' : 'Top artists'],
    ...(whole ? [['whole', 'Whole albums'] as [string, string]] : []), ['eras', 'Eras'], ['timeline', 'Timeline'], ['ranks', 'Rankings']];
  const [view, setView] = useState('list');
  const [style, setStyle] = useState<'stream' | 'flow'>('stream');
  const [by, setBy] = useState<'time' | 'plays'>('time');
  const [hover, setHover] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const noun = kind === 'track' ? 'songs' : `${kind}s`;
  const table = useMemo(() => ({ rows: block.list, total: block.list.length, includedMs: block.list.reduce((a, r) => a + r.ms, 0) }), [block]);
  const r = view === 'eras' ? block.eras : view === 'ranks' ? block.ranks.agg : block.timeline;
  return (
    <section className="card chart-card">
      <div className="tabs" role="tablist" aria-label="View">
        {views.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <header className="chart-head">
        <div>
          <h2 className="chart-title">{view === 'list' ? `Top ${noun}` : view === 'whole' ? 'Whole albums, front to back' : view === 'eras' ? `${noun[0].toUpperCase()}${noun.slice(1)} by era` : view === 'ranks' ? `How the top ${noun} ranked each year` : `Top ${noun} over time`}</h2>
          <p className="muted small chart-sub">{view === 'list' ? 'Ranked over the whole report period' : view === 'whole' ? 'Albums played (almost) all the way through in one sitting' : `Listening hours · ${r.periods[0]?.label ?? ''} – ${r.periods[r.periods.length - 1]?.label ?? ''}`}</p>
        </div>
        <div className="chart-actions">
          {view === 'list' && <Segmented<'time' | 'plays'> label="Rank by" value={by} onChange={setBy} options={[['time', 'Listening time'], ['plays', kind === 'album' ? 'Album listens' : 'Times played']]} />}
          {view === 'timeline' && <Segmented<'stream' | 'flow'> label="Show as" value={style} onChange={setStyle} options={[['stream', 'Stream'], ['flow', 'Flow']]} />}
        </div>
      </header>
      <div ref={ref} className="chart-area">
        {view === 'list' ? <Leaderboard kind={kind} table={table} minSeconds={30} by={by} onOpen={() => undefined} />
          : view === 'whole' && whole ? <WholeAlbumsBody data={whole} theme={theme} dateFmt={dateFmt} />
          : view === 'eras' ? <ErasChart result={block.eras} metric="hours" sort="peak" width={width} theme={theme} onSelect={() => undefined} />
          : view === 'ranks' ? <BumpChart result={block.ranks.agg} ranks={block.ranks.ranks} metric="hours" maxRank={10} width={width} theme={theme} highlight={hover} onSelect={() => undefined} />
          : style === 'flow' ? <FlowChart result={block.timeline} metric="hours" otherMode="below" width={width} theme={theme} highlight={hover} onSelect={() => undefined} />
          : <StackedArea result={block.timeline} metric="hours" shape="smooth" otherMode="below" width={width} theme={theme} highlight={hover} onSelect={() => undefined} />}
      </div>
      {(view === 'timeline' || view === 'ranks') && (
        <Legend result={view === 'ranks' ? { ...block.ranks.agg, series: block.ranks.agg.series.filter((x) => x.kind === 'item') } : block.timeline}
          metric="hours" theme={theme} pinned={null} otherMode="below" onHover={setHover} onTogglePin={() => undefined} />
      )}
    </section>
  );
}

function GenrePanel({ g, theme }: { g: NonNullable<ReportData['genres']>; theme: ReturnType<typeof useTheme> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'timeline'>('timeline');
  const table = useMemo(() => ({ rows: g.list, total: g.list.length, includedMs: g.list.reduce((a, r) => a + r.ms, 0) }), [g]);
  return (
    <section className="card chart-card">
      <div className="tabs" role="tablist" aria-label="View">
        {(['timeline', 'list'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{k === 'list' ? 'Top genres' : 'Genre branches over time'}</button>)}
      </div>
      <div ref={ref} className="chart-area">
        {view === 'list' ? <Leaderboard kind="genre" table={table} minSeconds={30} by="time" onOpen={() => undefined} />
          : <StackedArea result={g.timeline} metric="hours" shape="smooth" otherMode="below" width={width} theme={theme} highlight={hover} onSelect={() => undefined} />}
      </div>
      {view === 'timeline' && <Legend result={g.timeline} metric="hours" theme={theme} pinned={null} otherMode="below" onHover={setHover} onTogglePin={() => undefined} />}
    </section>
  );
}

function Report({ data }: { data: ReportData }) {
  const tabs = (['story', 'artists', 'albums', 'songs', 'genres', 'habits', 'patterns'] as Tab[]).filter((t) => (t === 'story' ? data.story : data[t]));
  const [nav, setNav] = useState(() => readHash(tabs));
  const [pref, setPref] = useState<ThemePref>('system');
  const theme = useTheme(pref);
  useEffect(() => {
    const on = () => setNav(readHash(tabs));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // When embedded in an iframe, tell the parent page our height so it can size the frame.
  useEffect(() => {
    if (window.parent === window) return;
    const post = () => window.parent.postMessage({ type: 'listening-report:height', height: document.documentElement.scrollHeight }, '*');
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, []);
  const month = data.precision === 'month';
  const dayFmt = (d: number) => new Date(d * DAY).toLocaleDateString('en-US', month ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dateFmt = (t: number) => (month ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : new Date(t).toISOString().slice(0, 10));
  const go = (t: Tab) => { window.location.hash = nav.embed ? `${t}&embed` : t; };
  const tab = nav.tab;
  return (
    <div className={`app report${nav.embed ? ' embed' : ''}`}>
      {!nav.embed && (
        <header className="app-header report-head">
          <div className="brand">
            <h1>{data.title}</h1>
            <p className="muted small">{data.author ? `${data.author} · ` : ''}{data.rangeLabel}{data.rangeLabel ? ' · ' : ''}Spotify listening, summarised</p>
          </div>
          <Segmented<ThemePref> label="Theme" value={pref} onChange={setPref} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />
        </header>
      )}
      {!nav.embed && tabs.length > 1 && (
        <nav className="subnav report-tabs" aria-label="Report sections">
          {tabs.map((t) => <button key={t} type="button" className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>{TAB_LABEL[t]}</button>)}
        </nav>
      )}
      {tab === 'story' && data.story && (
        <>
          <StoryBody sum={data.story.summary} ins={data.story.insights} minSeconds={data.minSeconds} routine={data.routine} dayFmt={dayFmt} />
          {data.top && (
            <div className="top-grid">
              <TopListCard kind="artist" title="Top artists" rows={data.top.artist} />
              <TopListCard kind="album" title="Top albums" rows={data.top.album} />
              <TopListCard kind="track" title="Top songs" rows={data.top.track} />
              {data.top.genre && <TopListCard kind="genre" title="Top genres" rows={data.top.genre} />}
            </div>
          )}
        </>
      )}
      {tab === 'artists' && data.artists && <KindPanel block={data.artists} kind="artist" theme={theme} dateFmt={dateFmt} />}
      {tab === 'albums' && data.albums && <KindPanel block={data.albums} kind="album" theme={theme} whole={data.albums.whole} dateFmt={dateFmt} />}
      {tab === 'songs' && data.songs && <KindPanel block={data.songs} kind="track" theme={theme} dateFmt={dateFmt} />}
      {tab === 'genres' && data.genres && <GenrePanel g={data.genres} theme={theme} />}
      {tab === 'habits' && data.habits && <InsightsBody ins={data.habits} theme={theme} routine={data.routine} dayFmt={dayFmt} />}
      {tab === 'patterns' && data.patterns && <PatternsBody p={data.patterns} theme={theme} />}
      <footer className="report-foot muted small">
        {data.notes.map((n) => <p key={n}>{n}</p>)}
        <p>Generated {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} with Listening Timeline. This page makes no network requests.</p>
      </footer>
    </div>
  );
}

const el = document.getElementById('report-data');
const data = el ? (JSON.parse(el.textContent ?? '{}') as ReportData) : null;
const root = document.getElementById('root');
if (root && data?.format === 'listening-report') {
  createRoot(root).render(<StrictMode><Report data={data} /></StrictMode>);
} else if (root) {
  root.textContent = 'This report file is missing its data.';
}
