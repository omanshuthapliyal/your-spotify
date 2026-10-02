import { useEffect, useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import { DEFAULT_REPORT_OPTIONS, type ReportData, type ReportOptions } from '../report/types';
import { embedCovers, reportHtml, EMBED_SNIPPET } from '../report/exportReport';
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

export function ShareDialog({ client, settings, timeZone, hasGenres, onClose }: {
  client: WorkerClient; settings: AggregateSettings; timeZone: string; hasGenres: boolean; onClose: () => void;
}) {
  const [o, setO] = useState<ReportOptions>({ ...DEFAULT_REPORT_OPTIONS, sections: { ...DEFAULT_REPORT_OPTIONS.sections, genres: hasGenres } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ file: string; size: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const sec = (k: keyof ReportOptions['sections'], v: boolean) => setO((x) => ({ ...x, sections: { ...x.sections, [k]: v } }));
  const anySection = Object.values(o.sections).some(Boolean);
  const file = `${(o.title.trim() || 'listening-report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'listening-report'}.html`;

  const create = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const viewer = (await import('virtual:report-viewer')).default;
      if (!viewer) throw new Error('The report viewer is not built. Run `npm run build` (it includes `npm run build:report`).');
      let data = await client.request<ReportData>({ type: 'report', settings, options: o, timeZone });
      if (o.covers) data = await embedCovers(data);
      const html = reportHtml(data, viewer);
      const blob = new Blob([html], { type: 'text/html' });
      saveBlob(blob, file);
      setDone({ file, size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="card modal" role="dialog" aria-modal="true" aria-labelledby="share-title" data-testid="share-dialog">
        <header className="drawer-head">
          <div>
            <h2 id="share-title" className="chart-title">Share your results</h2>
            <p className="muted small">Creates one interactive HTML file with summary statistics only. It never contains your ZIP, individual plays, or data such as IP addresses or devices. The file makes no network requests.</p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
        </header>
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
        <div className="share-grid">
          <div className="control"><span className="control-label">Dates</span>
            <div className="segmented" role="radiogroup" aria-label="Date detail">
              {(['month', 'day'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={o.precision === p} className={o.precision === p ? 'on' : ''} onClick={() => setO({ ...o, precision: p })}>{p === 'month' ? 'Months only' : 'Exact days'}</button>)}
            </div>
          </div>
          <label className="control"><span className="control-label">List length</span>
            <select value={o.listSize} onChange={(e) => setO({ ...o, listSize: Number(e.target.value) })} aria-label="List length">
              {[10, 25, 50, 100].map((v) => <option key={v} value={v}>Top {v}</option>)}
            </select></label>
          <label className="check share-covers"><input type="checkbox" checked={o.covers} onChange={(e) => setO({ ...o, covers: e.target.checked })} /> Embed album covers (adds ~1–2 MB)</label>
        </div>
        {o.sections.routine && o.precision === 'month' && <p className="muted small">With “Months only”, the daily calendar is left out (it cannot be month-level).</p>}
        <p className="muted small">The report uses your current filters: dates, minimum play length and top N.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={create} disabled={busy || !anySection} data-testid="create-report">{busy ? 'Creating…' : 'Download report'}</button>
        </div>
        {done && (
          <div className="share-done" data-testid="share-done">
            <p><b>{done.file}</b> saved ({(done.size / 1_000_000).toFixed(1)} MB). Open it in any browser, send it, or upload it to your site.</p>
            <p className="muted small">To embed one section in a blog post, upload the file next to the post and paste this (change <code>story</code> to <code>artists</code>, <code>albums</code>, <code>songs</code>, <code>genres</code>, <code>habits</code> or <code>patterns</code>):</p>
            <pre className="snippet" data-testid="embed-snippet">{EMBED_SNIPPET(done.file, 'story')}</pre>
            <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(EMBED_SNIPPET(done.file, 'story')).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Copied' : 'Copy embed code'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
