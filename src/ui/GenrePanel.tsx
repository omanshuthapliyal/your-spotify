import { useRef } from 'react';
import type { AggregateResult } from '../core/aggregate';
import type { GenreSummary } from '../worker/engine';
import { fmtInt } from './format';

interface Props {
  open: boolean;
  onToggle: (open: boolean) => void;
  source: string | null;
  summary: GenreSummary | null;
  result: AggregateResult | null; // current genre aggregate, for coverage
  error: string | null;
  onCsv: (text: string) => void;
  onTemplate: () => void;
  onClear: () => void;
}

export function GenrePanel({ open, onToggle, source, summary, result, error, onCsv, onTemplate, onClear }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const un = result?.series.find((s) => s.kind === 'unclassified');
  const coverage = result && un && result.included.ms > 0 ? (1 - un.totalMs / result.included.ms) * 100 : null;
  return (
    <details className="card genre-panel" id="genres" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>Genres</b>{' '}
        {summary
          ? <span className="muted small" data-testid="genre-status">mapping {source ?? 'loaded'} · {summary.mappedArtists} of {summary.totalArtists} artists · explore it above</span>
          : <span className="muted small">(optional: from your own artist-to-genre CSV)</span>}
      </summary>
      <div className="grid2">
        <div className="small">
          <p>
            Spotify’s streaming history has <b>no genre field</b>, so this app never guesses genres.
            To see genres, supply a CSV that maps artist names to genres:
          </p>
          <p><b>Easiest: two steps.</b></p>
          <ol className="genre-steps">
            <li>In a terminal, in the project folder, run<br /><code>npm run genres -- --zip ~/Downloads/my_spotify_data.zip</code><br />
              It reads your export on your computer and sends <b>only your top 300 artist names</b> to MusicBrainz (a public music database), about 5 min. It writes <code>artist-genres-musicbrainz.csv</code> in the project folder.</li>
            <li>Click <b>Load genre CSV</b> below and pick that file.</li>
          </ol>
          <p className="muted">Or fill in genres yourself: <b>Download template</b>, add a genre per artist, and load it:</p>
          <pre className="csv-example">artist,genre{'\n'}Artist A,Indie Rock{'\n'}Artist B,Electronic; Pop</pre>
          <ul>
            <li>Names must match the export exactly. Near matches (case or accents) are reported, not applied.</li>
            <li>Several genres (separated by “;”, extra columns, or repeated rows) share the artist’s time <b>equally</b>, so totals still add up.</li>
            <li>Artists not in the CSV count as <b>Unclassified</b>, which always stays visible.</li>
          </ul>
          <div className="row-actions">
            <button type="button" className="btn" onClick={onTemplate}>Download template (your top 300 artists)</button>
            <button type="button" className="btn primary" onClick={() => input.current?.click()}>Load genre CSV</button>
            <input ref={input} type="file" accept=".csv,text/csv" hidden data-testid="genre-input" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onCsv(await f.text());
            }} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
        {summary && (
          <div className="small" data-testid="genre-summary">
            <h4>Mapping loaded</h4>
            {coverage !== null && (
              <>
                <div className="coverage-bar" aria-hidden="true"><span style={{ width: `${coverage}%` }} /></div>
                <p><b data-testid="genre-coverage">{coverage.toFixed(1)}%</b> of listening time in the current view has a genre.</p>
              </>
            )}
            <p>{fmtInt(summary.mappedArtists)} of {fmtInt(summary.totalArtists)} exported artists mapped to {fmtInt(summary.genres)} genres · {fmtInt(summary.multiGenreArtists)} with several genres (time split equally).</p>
            {summary.nearMatches.length > 0 && (
              <>
                <p><b>Near matches not applied</b> (fix the spelling in your CSV if they are the same artist):</p>
                <ul>{summary.nearMatches.slice(0, 15).map((n) => <li key={n.csv}>“{n.csv}” ≈ {n.exported.map((e) => `“${e}”`).join(', ')}</li>)}</ul>
              </>
            )}
            {summary.unmatchedCsvArtists.length > 0 && <p>{fmtInt(summary.unmatchedCsvArtists.length)} CSV artists are not in this export.</p>}
            {summary.issues.length > 0 && (
              <details><summary>{summary.issues.length} CSV notes</summary><ul>{summary.issues.slice(0, 50).map((i, k) => <li key={k}>{i}</li>)}</ul></details>
            )}
            <button type="button" className="btn ghost" onClick={onClear}>Remove mapping</button>
          </div>
        )}
      </div>
    </details>
  );
}
