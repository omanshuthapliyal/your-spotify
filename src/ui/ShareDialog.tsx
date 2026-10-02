import { useEffect, useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import { DEFAULT_REPORT_OPTIONS, type ReportData, type ReportOptions } from '../report/types';
import { embedCovers, reportHtml, EMBED_SNIPPET, HUGO_SNIPPET } from '../report/exportReport';
import { PLOTS, plotById } from '../report/plots';
import type { WorkerClient } from './workerClient';
import { saveBlob } from './download';

const SECTION_INFO: Array<[keyof ReportOptions['sections'], string, string]> = [
  ['story', 'Story', 'Headline numbers, highlights, year by year, top lists'],
  ['artists', 'Artists', 'Top artists list, eras, timeline, rankings'],
  ['albums', 'Albums', 'Top albums, whole albums, eras, timeline, rankings'],
  ['songs', 'Songs', 'Top songs, eras, timeline, rankings'],
  ['genres', 'Genres', 'Top genres and genre branches over time'],
  ['habits', 'Habits', 'Discovery, variety, skips, shuffle, music age, comebacks, loyalty'],
  ['patterns', 'Patterns', 'Eras, tastes over time, who you play together, how artists come and go'],
  ['routine', 'Daily routine', 'Calendar of days, time of day, sessions, single-day binges. Reveals when you are awake, away or busy.'],
];

const slug = (s: string, fallback: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;

/**
 * Export a whole report, or one plot on its own for embedding in a blog post. A one-plot file
 * holds only that plot's data, so it stays small and shares nothing else.
 */
export function ShareDialog({ client, settings, timeZone, hasGenres, initialPlot, initialBranch, onClose }: {
  client: WorkerClient; settings: AggregateSettings; timeZone: string; hasGenres: boolean; initialPlot?: string | null;
  /** For the genre stream: the branch whose sub-genres to show. */
  initialBranch?: { id: string; label: string };
  onClose: () => void;
}) {
  const [branch, setBranch] = useState(initialBranch ?? null);
  const [o, setO] = useState<ReportOptions>({ ...DEFAULT_REPORT_OPTIONS, sections: { ...DEFAULT_REPORT_OPTIONS.sections, genres: hasGenres } });
  const [mode, setMode] = useState<'report' | 'plot'>(initialPlot ? 'plot' : 'report');
  const [plotId, setPlotId] = useState(initialPlot ?? 'map');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ file: string; size: number; plot: string | null } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [embedTheme, setEmbedTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const sec = (k: keyof ReportOptions['sections'], v: boolean) => setO((x) => ({ ...x, sections: { ...x.sections, [k]: v } }));
  const plots = PLOTS.filter((p) => !p.genres || hasGenres);
  const plot = mode === 'plot' ? plotById(plotId) : null;
  const groups = [...new Set(plots.map((p) => p.group))];
  const anySection = mode === 'plot' ? plot !== null : Object.values(o.sections).some(Boolean);
  const file = plot ? (plot.id === 'genres-timeline' && branch ? `genres-${slug(branch.label, 'branch')}.html` : `${plot.id}.html`) : `${slug(o.title.trim(), 'listening-report')}.html`;
  const usesCovers = !plot || plot.part === 'list' || plot.part === 'whole' || plot.id === 'story';

  const create = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const viewer = (await import('virtual:report-viewer')).default;
      if (!viewer) throw new Error('The report viewer is not built. Run `npm run build` (it includes `npm run build:report`).');
      const options: ReportOptions = { ...o, plot: plot?.id ?? null, plotBranch: plot?.id === 'genres-timeline' ? branch?.id ?? null : null, covers: o.covers && usesCovers };
      let data = await client.request<ReportData>({ type: 'report', settings, options, timeZone });
      if (options.covers) data = await embedCovers(data);
      const html = reportHtml(data, viewer);
      const blob = new Blob([html], { type: 'text/html' });
      saveBlob(blob, file);
      setDone({ file, size: blob.size, plot: plot?.id ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the report.');
    } finally {
      setBusy(false);
    }
  };
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text).then(() => setCopied(key)).catch(() => setCopied(null)); };
  const target = `${done?.plot ? `plot=${done.plot}` : 'story'}${embedTheme !== 'auto' ? `&theme=${embedTheme}` : ''}`;

  return (
    <div className="modal-back" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="card modal" role="dialog" aria-modal="true" aria-labelledby="share-title" data-testid="share-dialog">
        <header className="drawer-head">
          <div>
            <h2 id="share-title" className="chart-title">Share your results</h2>
            <p className="muted small">Creates an interactive HTML file with summary statistics only. It never contains your ZIP, individual plays, or data such as IP addresses or devices. The file makes no network requests.</p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="segmented share-mode" role="radiogroup" aria-label="What to export">
          <button type="button" role="radio" aria-checked={mode === 'report'} className={mode === 'report' ? 'on' : ''} onClick={() => { setMode('report'); setDone(null); }}>Whole report</button>
          <button type="button" role="radio" aria-checked={mode === 'plot'} className={mode === 'plot' ? 'on' : ''} onClick={() => { setMode('plot'); setDone(null); }}>One plot, for embedding</button>
        </div>
        {mode === 'plot' ? (
          <>
            <label className="control share-plot"><span className="control-label">Plot</span>
              <select value={plotId} onChange={(e) => { setPlotId(e.target.value); setBranch(null); setDone(null); }} aria-label="Plot to export">
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {plots.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                ))}
              </select></label>
            {plot?.id === 'genres-timeline' && branch && <p className="small" data-testid="share-branch">Branch: <b>{branch.label}</b> (its sub-genres over time) <button type="button" className="link" onClick={() => setBranch(null)}>use the top level instead</button></p>}
            <p className="muted small">The file holds only this plot's data and stays fully interactive (hover, zoom, view switches). {plot?.routine ? 'This plot shows your daily routine: when you listen on which days.' : ''}</p>
            <div className="share-grid">
              <label className="control"><span className="control-label">Your name (optional, shown under the plot)</span>
                <input type="text" value={o.author} maxLength={60} onChange={(e) => setO({ ...o, author: e.target.value })} aria-label="Your name" /></label>
            </div>
          </>
        ) : (
          <>
            <div className="share-grid">
              <label className="control"><span className="control-label">Title</span>
                <input type="text" value={o.title} maxLength={80} onChange={(e) => setO({ ...o, title: e.target.value })} aria-label="Report title" /></label>
              <label className="control"><span className="control-label">Your name (optional)</span>
                <input type="text" value={o.author} maxLength={60} onChange={(e) => setO({ ...o, author: e.target.value })} aria-label="Your name" /></label>
            </div>
            <h4 className="sub-h">Include</h4>
            <ul className="share-sections">
              {SECTION_INFO.map(([k, label, hint]) => (
                <li key={k} className={k === 'routine' ? 'routine' : ''}>
                  <label className="check">
                    <input type="checkbox" checked={o.sections[k]} disabled={k === 'genres' && !hasGenres} onChange={(e) => sec(k, e.target.checked)} aria-label={label} />
                    <span><b>{label}</b> <span className="muted small">{k === 'genres' && !hasGenres ? 'No genre mapping loaded' : hint}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="share-grid">
          <div className="control"><span className="control-label">Dates</span>
            <div className="segmented" role="radiogroup" aria-label="Date detail">
              {(['month', 'day'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={o.precision === p} className={o.precision === p ? 'on' : ''} onClick={() => setO({ ...o, precision: p })}>{p === 'month' ? 'Months only' : 'Exact days'}</button>)}
            </div>
          </div>
          {(!plot || plot.part === 'list' || plot.part === 'whole') && (
            <label className="control"><span className="control-label">List length</span>
              <select value={o.listSize} onChange={(e) => setO({ ...o, listSize: Number(e.target.value) })} aria-label="List length">
                {[10, 25, 50, 100].map((v) => <option key={v} value={v}>Top {v}</option>)}
              </select></label>
          )}
          {usesCovers && <label className="check share-covers"><input type="checkbox" checked={o.covers} onChange={(e) => setO({ ...o, covers: e.target.checked })} /> Embed album covers (adds ~1–2 MB)</label>}
        </div>
        {((mode === 'report' && o.sections.routine) || plot?.id === 'habits-calendar') && o.precision === 'month' && <p className="muted small">With “Months only”, the daily calendar is left out (it cannot be month-level).</p>}
        <p className="muted small">Uses your current filters: dates, minimum play length and top N.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={create} disabled={busy || !anySection} data-testid="create-report">{busy ? 'Creating…' : mode === 'plot' ? 'Download plot' : 'Download report'}</button>
        </div>
        {done && (
          <div className="share-done" data-testid="share-done">
            <p><b>{done.file}</b> saved ({done.size >= 100_000 ? `${(done.size / 1_000_000).toFixed(1)} MB` : `${Math.round(done.size / 1000)} KB`}). Open it in any browser, send it, or put it on your site.</p>
            <p className="muted small">
              {done.plot ? 'To embed it in a post, upload the file next to the post and paste this:'
                : <>To embed one section in a post, upload the file next to the post and paste this (change <code>story</code> to <code>artists</code>, <code>albums</code>, <code>songs</code>, <code>genres</code>, <code>habits</code> or <code>patterns</code>):</>}
            </p>
            <div className="control"><span className="control-label">Colours in your post</span>
              <div className="segmented" role="radiogroup" aria-label="Embed colours">
                {([['auto', "Follow the reader's device"], ['light', 'Always light'], ['dark', 'Always dark']] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={embedTheme === v} className={embedTheme === v ? 'on' : ''} onClick={() => setEmbedTheme(v)}>{l}</button>
                ))}
              </div>
            </div>
            <p className="muted small">Pick “Always light” or “Always dark” if your blog has one fixed look, so the plot matches it.</p>
            <pre className="snippet" data-testid="embed-snippet">{EMBED_SNIPPET(done.file, target)}</pre>
            <button type="button" className="btn" onClick={() => copy('html', EMBED_SNIPPET(done.file, target))}>{copied === 'html' ? 'Copied' : 'Copy embed code'}</button>
            <p className="muted small">Hugo, with the <code>listening</code> shortcode from the repo (<code>docs/hugo-shortcode.html</code>) and the file in <code>static/listening/</code>:</p>
            <pre className="snippet" data-testid="hugo-snippet">{HUGO_SNIPPET(done.file, done.plot, embedTheme)}</pre>
            <button type="button" className="btn" onClick={() => copy('hugo', HUGO_SNIPPET(done.file, done.plot, embedTheme))}>{copied === 'hugo' ? 'Copied' : 'Copy Hugo shortcode'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
