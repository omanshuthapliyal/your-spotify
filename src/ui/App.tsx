import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { ImportAudit } from '../core/importer';
import { enumeratePeriods } from '../core/period';
import { detectActiveRange, monthStart, type ActiveRange } from '../core/coverage';
import type { EnrichmentSummary, GenreSummary, SearchHit } from '../worker/engine';
import { WorkerClient } from './workerClient';
import { useTheme, type ThemePref } from './theme';
import { Segmented } from './Controls';
import { ImportPanel } from './ImportPanel';
import { AuditPanel } from './AuditPanel';
import { FilterBar } from './FilterBar';
import { ExploreView, type ChartOptions, type ViewKind } from './ExploreView';
import { EntityPanel, type EntityRef } from './EntityPanel';
import { GenreExplorer } from './GenreExplorer';
import { GenrePanel } from './GenrePanel';
import { DecadesCard } from './DecadesCard';
import { TopLists } from './Overview';
import { Story } from './Story';
import { InsightsView, HABIT_SECTIONS } from './InsightsView';
import { SearchBox } from './SearchBox';
import { ShareDialog } from './ShareDialog';
import { PatternsView, StoryEras, PATTERN_SECTIONS } from './PatternsView';
import { browserTimeZone } from '../core/tz';
import { csvCell, saveBlob } from './download';
import bakedGenres from 'virtual:baked-genres';

const DEFAULT_SETTINGS: AggregateSettings = { granularity: 'quarter', metric: 'hours', topN: 12, minMs: 30_000, range: null };

/** Five areas: the summary, browsing your library, listening habits, learned patterns, and the data behind it all. */
type Area = 'story' | 'explore' | 'habits' | 'patterns' | 'data';
type Library = 'artists' | 'albums' | 'songs' | 'genres';
const AREAS: Array<[Area, string, string]> = [
  ['story', 'Story', 'Your listening at a glance'],
  ['explore', 'Explore', 'Artists, albums, songs and genres'],
  ['habits', 'Habits', 'When and how you listen'],
  ['patterns', 'Patterns', 'Eras, tastes and who you play together'],
  ['data', 'Data', 'Import, sources and settings'],
];
const LIBRARY: Array<[Library, string]> = [['artists', 'Artists'], ['albums', 'Albums'], ['songs', 'Songs'], ['genres', 'Genres']];
const LIB_VIEWS: Record<'artists' | 'albums' | 'songs', ViewKind[]> = {
  artists: ['list', 'eras', 'timeline', 'ranks'],
  albums: ['list', 'whole', 'eras', 'timeline', 'ranks'],
  songs: ['list', 'eras', 'timeline', 'ranks'],
};
const LIST_LABEL = { artists: 'Top artists', albums: 'Top albums', songs: 'Top songs' } as const;
const LIB_KIND = { artists: 'artist', albums: 'album', songs: 'track' } as const;
const DEFAULT_OPTS: ChartOptions = { style: 'stream', shape: 'smooth', laneCount: 20, erasSort: 'peak', maxRank: 10, rankPer: 'year', rankBy: 'time', clockZone: 'local', offset: 0 };

function activeToRange(a: ActiveRange) {
  return { from: monthStart(a.fromMonth), to: monthStart(a.toMonth + 1) - 1 };
}

/** Navigation lives in the URL hash (#explore/albums) so back/forward and reloads keep your place. */
function parseHash(): { area: Area; lib: Library } {
  const [a, l] = window.location.hash.replace(/^#/, '').split('/');
  const area = (AREAS.some(([k]) => k === a) ? a : 'story') as Area;
  const lib = (LIBRARY.some(([k]) => k === l) ? l : 'artists') as Library;
  return { area, lib };
}

export function App() {
  const client = useMemo(() => new WorkerClient(), []);
  const [themePref, setThemePref] = useState<ThemePref>('system');
  const theme = useTheme(themePref);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [audit, setAudit] = useState<ImportAudit | null>(null);
  const [active, setActive] = useState<ActiveRange | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<AggregateSettings>(DEFAULT_SETTINGS);
  const [nav, setNav] = useState(parseHash);
  const [views, setViews] = useState<Record<'artists' | 'albums' | 'songs' | 'story', ViewKind>>({ artists: 'list', albums: 'list', songs: 'list', story: 'timeline' });
  const [opts, setOpts] = useState<ChartOptions>(DEFAULT_OPTS);
  const [entityStack, setEntityStack] = useState<EntityRef[]>([]);
  const entity = entityStack.length ? entityStack[entityStack.length - 1] : null;
  const setEntity = useCallback((e: EntityRef | null) => setEntityStack(e ? [e] : []), []);
  const [genreNode, setGenreNode] = useState('root');
  const [genreSummary, setGenreSummary] = useState<GenreSummary | null>(null);
  const [genreSource, setGenreSource] = useState<string | null>(null);
  const [genreError, setGenreError] = useState<string | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentSummary | null>(null);
  const timeZone = useMemo(() => browserTimeZone(), []);
  /** Share dialog: closed (null), or open with an optional plot preselected. */
  const [sharing, setSharing] = useState<{ plot: string | null; branch?: { id: string; label: string } } | null>(null);
  const embed = useCallback((plot: string, branch?: { id: string; label: string }) => setSharing({ plot, branch }), []);
  const coverCount = bakedGenres?.art ? Object.values(bakedGenres.art).filter(Boolean).length : 0;

  useEffect(() => {
    client.onProgress = (done, total, label) => setProgress({ done, total, label });
    const onHash = () => setNav(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [client]);

  const go = useCallback((area: Area, lib?: Library) => {
    const next = { area, lib: lib ?? nav.lib };
    const hash = `#${area}${area === 'explore' ? `/${next.lib}` : ''}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setNav(next);
    window.scrollTo({ top: 0 });
  }, [nav.lib]);

  const applyEnrichment = useCallback(async () => {
    setEnrichment(await client.request<EnrichmentSummary>({
      type: 'setEnrichment', tree: bakedGenres?.tree ?? null, artistCsv: bakedGenres?.artistInfo ?? null, albumCsv: bakedGenres?.albumYears ?? null,
    }));
    await client.request({ type: 'setArt', index: bakedGenres?.art ?? null });
  }, [client]);

  const runImport = useCallback(async (files: File[], isDemo = false) => {
    setBusy(true);
    setProgress(null);
    setImportError(null);
    setEntity(null);
    setGenreSummary(null);
    setGenreSource(null);
    try {
      const a = await client.request<ImportAudit>({ type: 'import', files });
      setAudit(a);
      if (a.error) setImportError(a.error);
      else {
        const act = detectActiveRange(a.monthly);
        setActive(act);
        setDemo(isDemo);
        setSettings({ ...DEFAULT_SETTINGS, range: act.trimmed ? activeToRange(act) : null });
        setGenreNode('root');
        // Built-in genre mapping (baked into this local build): applied when it matches this export.
        if (bakedGenres) {
          const summary = await client.request<GenreSummary>({ type: 'setGenres', csv: bakedGenres.csv });
          if (summary.mappedArtists > 0) {
            setGenreSummary(summary);
            setGenreSource(`built in: ${bakedGenres.name}`);
          } else await client.request({ type: 'clearGenres' });
        }
        await applyEnrichment();
        setVersion((v) => v + 1);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }, [client, applyEnrichment, setEntity]);

  const loadDemo = useCallback(async () => {
    const { extendedFixtureFiles } = await import('../../fixtures/synthetic');
    const files = extendedFixtureFiles().map((f) => new File([f.content], f.name, { type: 'application/json' }));
    await runImport(files, true);
  }, [runImport]);

  const reset = async () => {
    await client.request({ type: 'reset' });
    setAudit(null);
    setImportError(null);
    setDemo(false);
    setGenreSummary(null);
    setEntity(null);
    go('story');
  };

  const loadGenres = async (csv: string) => {
    setGenreError(null);
    try {
      const summary = await client.request<GenreSummary>({ type: 'setGenres', csv });
      if (summary.mappedArtists === 0) {
        await client.request({ type: 'clearGenres' });
        setGenreSummary(null);
        setGenreError(summary.rows === 0 ? 'This CSV has no genre values filled in (every artist row is blank), so there is nothing to show yet.' : 'None of the artists with a genre in this CSV exactly match an artist name in your export.');
        return;
      }
      setGenreSummary(summary);
      setGenreSource('loaded from file');
      setGenreNode('root');
      await applyEnrichment();
      setVersion((v) => v + 1);
      go('explore', 'genres');
    } catch (e) {
      setGenreError(e instanceof Error ? e.message : 'Could not read the CSV.');
    }
  };
  const clearGenres = async () => {
    await client.request({ type: 'clearGenres' });
    setGenreSummary(null);
    setVersion((v) => v + 1);
  };
  const downloadTemplate = async () => {
    const names = await client.request<string[]>({ type: 'artistList', limit: 300 });
    const body = ['artist,genre', ...names.map((n) => `${csvCell(n)},`)].join('\n') + '\n';
    saveBlob(new Blob([body], { type: 'text/csv' }), 'artist-genres-template.csv');
  };

  const openEntity = useCallback((kind: 'artist' | 'album' | 'track', id: number) => setEntity({ kind, id }), [setEntity]);
  const openBranch = useCallback((nodeId: string) => {
    setGenreNode(nodeId);
    setEntity(null);
    go('explore', 'genres');
  }, [setEntity, go]);

  const ready = audit !== null && !audit.error && version > 0;
  const dataYears = useMemo(() => {
    if (!audit || !active) return [];
    const ys = new Set<number>();
    audit.monthly.counts.forEach((v, i) => { const ord = audit.monthly.firstMonth + i; if (v > 0 && ord >= active.fromMonth && ord <= active.toMonth) ys.add(Math.floor(ord / 12)); });
    return [...ys].sort();
  }, [audit, active]);
  const onSearchPick = (h: SearchHit) => {
    if (h.kind === 'genre') openBranch(String(h.id));
    else openEntity(h.kind, Number(h.id));
  };
  const fullPeriods = useMemo(
    () => (audit?.firstPlay != null && audit.lastPlay != null ? enumeratePeriods(audit.firstPlay, audit.lastPlay, settings.granularity) : []),
    [audit, settings.granularity],
  );
  const rangeIsDefault: 'active' | 'full' | 'custom' = !settings.range ? 'full'
    : active?.trimmed && settings.range.from === activeToRange(active).from && settings.range.to === activeToRange(active).to ? 'active' : 'custom';
  const yearsAvailable = Boolean(enrichment && (enrichment.albumsWithYear || enrichment.artistsWithYear));
  const exportNotes = [
    `Source: Spotify Extended Streaming History, measured locally. Artist = album artist as exported.${genreSummary ? ' Genres, genre tree and years from MusicBrainz via my own lookup.' : ''}${demo ? ' SYNTHETIC DEMO DATA.' : ''}`,
  ];
  const { area, lib } = nav;
  const unitLabel = area === 'explore' ? (lib === 'albums' ? 'Top albums' : lib === 'songs' ? 'Top songs' : lib === 'genres' ? 'Top genres' : 'Top artists') : 'Top artists';
  const filterRelevant = area !== 'data';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Listening Timeline</h1>
          <p className="muted small">Your Spotify history, analysed in this tab only</p>
        </div>
        {ready && <SearchBox client={client} version={version} onPick={onSearchPick} />}
        {ready && <button type="button" className="btn primary share-btn" onClick={() => setSharing({ plot: null })}>Share</button>}
        <details className="menu settings">
          <summary className="btn ghost" aria-label="Settings">Settings</summary>
          <div className="menu-panel menu-right settings-panel">
            <Segmented<ThemePref> label="Theme" value={themePref} onChange={setThemePref} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
            <p className="muted small">
              <b>Private by design.</b> Your files are read in this tab; the page cannot make network requests, and nothing is saved. Reloading clears everything.
            </p>
            <p className="muted small">Charts group by UTC periods. The calendar, clock, sessions and streaks use your timezone ({timeZone}).</p>
            {audit && <button type="button" className="btn" onClick={reset}>Start over with another file</button>}
          </div>
        </details>
      </header>

      {(!ready || busy) && <ImportPanel busy={busy} progress={progress} onFiles={(f) => runImport(f)} onDemo={loadDemo} />}

      {importError && (
        <div className="card error" role="alert">
          <b>Couldn’t use this import.</b> {importError}
          {audit && audit.files.length > 0 && (
            <ul className="small">{audit.files.map((f, i) => <li key={i}><code>{f.name}</code>: {f.note ?? f.status}</li>)}</ul>
          )}
        </div>
      )}

      {ready && audit && active && !busy && (
        <>
          <nav className="areas" aria-label="Areas">
            {AREAS.map(([k, label, hint]) => (
              <button key={k} type="button" className={`area${area === k ? ' on' : ''}${k === 'data' ? ' area-minor' : ''}`} aria-current={area === k ? 'page' : undefined} onClick={() => go(k)}>
                <span className="area-label">{label}</span>
                <span className="area-hint">{hint}</span>
              </button>
            ))}
          </nav>

          {area === 'explore' && (
            <nav className="subnav" aria-label="Explore">
              {LIBRARY.map(([k, label]) => (
                <button key={k} type="button" className={lib === k ? 'on' : ''} aria-current={lib === k ? 'page' : undefined} onClick={() => go('explore', k)}>
                  {label}{k === 'genres' && !genreSummary ? <span className="muted"> · set up</span> : ''}
                </button>
              ))}
            </nav>
          )}
          {(area === 'habits' || area === 'patterns') && (
            <nav className="subnav subnav-anchors" aria-label={area === 'habits' ? 'Habits' : 'Patterns'}>
              {(area === 'habits' ? HABIT_SECTIONS : PATTERN_SECTIONS).map(([id, label]) => (
                <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}</button>
              ))}
            </nav>
          )}

          {filterRelevant && (
            <FilterBar settings={settings} periods={fullPeriods} years={dataYears} allRange={active.trimmed ? activeToRange(active) : null}
              topNLabel={unitLabel} showTopN={area !== 'habits' && area !== 'patterns'} onChange={setSettings}
              note={rangeIsDefault === 'active' ? <>Starting at your regular listening; {fmtCount(active.leading)} isolated earlier play{active.leading === 1 ? '' : 's'} left out. <button type="button" className="link" onClick={() => setSettings((s) => ({ ...s, range: null }))}>Include them</button></> : null} />
          )}

          {area === 'story' && (
            <>
              <Story client={client} settings={settings} timeZone={timeZone} version={version}
                onPickYear={(y) => setSettings((s) => ({ ...s, range: { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) - 1 } }))}
                onOpenEntity={openEntity} onDataQuality={() => go('data')} />
              <StoryEras client={client} theme={theme} settings={settings} version={version} onMore={() => go('patterns')} />
              <TopLists client={client} settings={settings} version={version} hasGenres={Boolean(genreSummary)} onOpenEntity={openEntity} onOpenBranch={openBranch}
                onSection={(s) => go('explore', s === 'tracks' ? 'songs' : s)} />
              <ExploreView client={client} theme={theme} settings={settings} kind={genreSummary ? 'branch' : 'artist'} views={['timeline', 'eras']} view={views.story}
                onView={(v) => setViews((s) => ({ ...s, story: v }))} opts={opts} onOpts={setOpts} onOpenEntity={openEntity} onOpenBranch={openBranch}
                exportNotes={exportNotes} version={version} timeZone={timeZone} testId="overview-explore" onEmbed={embed} />
            </>
          )}

          {area === 'explore' && lib !== 'genres' && (
            <>
              <ExploreView key={lib} client={client} theme={theme} settings={settings} kind={LIB_KIND[lib]} views={LIB_VIEWS[lib]} listLabel={LIST_LABEL[lib]}
                view={views[lib]} onView={(v) => setViews((s) => ({ ...s, [lib]: v }))} opts={opts} onOpts={setOpts}
                onOpenEntity={openEntity} onOpenBranch={openBranch} exportNotes={exportNotes} version={version} timeZone={timeZone} testId={`${lib}-explore`} onEmbed={embed} />
              {lib === 'albums' && <DecadesCard client={client} theme={theme} settings={settings} scope={null} available={yearsAvailable} version={version} />}
            </>
          )}
          {area === 'explore' && lib === 'genres' && (
            genreSummary && enrichment !== null ? (
              <GenreExplorer client={client} theme={theme} settings={settings} version={version} node={genreNode} onNode={setGenreNode}
                opts={opts} onOpts={setOpts} onOpenEntity={openEntity} yearsAvailable={yearsAvailable} mbEdges={enrichment.mbEdges} exportNotes={exportNotes} timeZone={timeZone} onEmbed={embed} />
            ) : (
              <GenrePanel open onToggle={() => undefined} source={genreSource} summary={genreSummary}
                result={null} error={genreError} onCsv={loadGenres} onTemplate={downloadTemplate} onClear={clearGenres} />
            )
          )}

          {area === 'habits' && (
            <InsightsView client={client} theme={theme} settings={settings} timeZone={timeZone} version={version} onOpenArtist={(id) => openEntity('artist', id)}
              clock={
                <ExploreView client={client} theme={theme} settings={settings} kind="artist" views={['clock']} view="clock" onView={() => undefined}
                  opts={opts} onOpts={setOpts} onOpenEntity={openEntity} onOpenBranch={openBranch} exportNotes={exportNotes} version={version} timeZone={timeZone} testId="clock-explore" />
              } />
          )}

          {area === 'patterns' && (
            <PatternsView client={client} theme={theme} settings={settings} version={version} onOpenArtist={(id) => openEntity('artist', id)} onEmbed={embed} />
          )}

          {area === 'data' && (
            <div className="data-area">
              <section className="card" id="data-quality">
                <h2 className="chart-title">Data quality</h2>
                <p className="muted small chart-sub">What was imported, what was left out, and why</p>
                <AuditPanel audit={audit} demo={demo} active={active} rangeIsDefault={rangeIsDefault}
                  onFullHistory={() => setSettings((s) => ({ ...s, range: null }))}
                  onActiveRange={() => setSettings((s) => ({ ...s, range: activeToRange(active) }))} />
              </section>
              <section className="card" data-testid="sources">
                <h2 className="chart-title">Extra data sources</h2>
                <p className="muted small chart-sub">Not in the Spotify export; added by scripts you ran, served from this app</p>
                <ul className="sources">
                  <li><b>Genres</b> {genreSummary ? `${genreSummary.mappedArtists} of ${genreSummary.totalArtists} artists (${genreSource})` : 'not set up'}</li>
                  <li><b>Genre tree</b> {enrichment?.treeNodes ? `${enrichment.treeNodes} branches (${enrichment.mbEdges} MusicBrainz links, ${enrichment.styleBranches} style branches)` : 'not loaded'}</li>
                  <li><b>Years</b> {enrichment && yearsAvailable ? `${enrichment.artistsWithYear} artists, ${enrichment.albumsWithYear} albums` : 'not loaded'}</li>
                  <li><b>Album covers</b> {coverCount ? `${coverCount} albums (Cover Art Archive)` : 'not loaded'}</li>
                </ul>
              </section>
              <GenrePanel open={!genreSummary || Boolean(genreError)} onToggle={() => undefined} source={genreSource} summary={genreSummary}
                result={null} error={genreError} onCsv={loadGenres} onTemplate={downloadTemplate} onClear={clearGenres} />
              <section className="card method small">
                <h2 className="chart-title">How this is measured</h2>
                <ul>
                  <li>Only music tracks from Extended Streaming History count; podcasts, audiobooks and invalid records are excluded (see Data quality).</li>
                  <li>Plays shorter than the minimum duration (default 30 s) are left out of charts; skip rates use all plays.</li>
                  <li>Periods are calendar months, quarters or years in UTC. Calendar, clock, sessions and streaks use your timezone.</li>
                  <li>Artist is the export’s album artist; albums are identified by album artist and album name; an album listen is a sitting with 3+ different tracks.</li>
                  <li>Genres, the genre tree, years and covers come from MusicBrainz and the Cover Art Archive via your own lookups, never from Spotify.</li>
                </ul>
              </section>
            </div>
          )}
        </>
      )}

      {sharing && ready && (
        <ShareDialog client={client} settings={settings} timeZone={timeZone} hasGenres={Boolean(genreSummary)} initialPlot={sharing.plot} initialBranch={sharing.branch} onClose={() => setSharing(null)} />
      )}
      {entity && ready && (
        <EntityPanel client={client} theme={theme} settings={settings} entity={entity} version={version} timeZone={timeZone}
          onOpen={(e) => setEntityStack((s) => [...s, e])}
          onBack={entityStack.length > 1 ? () => setEntityStack((s) => s.slice(0, -1)) : undefined}
          onOpenBranch={openBranch} onClose={() => setEntity(null)} />
      )}
    </div>
  );
}

function fmtCount(n: number) {
  return n.toLocaleString('en-US');
}
