import type { ImportAudit } from '../core/importer';
import { fmtDate, fmtHours, fmtInt } from './format';
import type { ActiveRange } from '../core/coverage';
import { monthStart } from '../core/coverage';

const REASONS: Array<[keyof ImportAudit['excluded'], string]> = [
  ['podcast', 'Podcast / video episodes'],
  ['audiobook', 'Audiobook chapters'],
  ['missingArtist', 'Music with no artist name'],
  ['unidentified', 'No track or episode metadata'],
  ['invalidDate', 'Invalid or implausible date'],
  ['malformed', 'Malformed records'],
  ['crossFileDuplicate', 'Duplicates across files (overlapping exports)'],
];

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Read', duplicate: 'Duplicate file', 'one-year': 'One-year format', unsupported: 'Unsupported',
  empty: 'Empty', 'invalid-json': 'Invalid JSON', ignored: 'Ignored', 'invalid-zip': 'Invalid ZIP',
};

function CoverageStrip({ monthly, active }: { monthly: ImportAudit['monthly']; active: ActiveRange }) {
  const c = monthly.counts;
  if (!c.length) return null;
  const max = Math.max(...c);
  const W = 1000;
  const H = 36;
  const bw = W / c.length;
  const label = (ord: number) => new Date(monthStart(ord)).toISOString().slice(0, 7);
  return (
    <figure className="coverage" aria-label={`Music plays per month from ${label(monthly.firstMonth)} to ${label(monthly.firstMonth + c.length - 1)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="coverage-svg" aria-hidden="true">
        {c.map((v, i) => {
          const inActive = monthly.firstMonth + i >= active.fromMonth && monthly.firstMonth + i <= active.toMonth;
          return v > 0 ? <rect key={i} x={i * bw} y={H - Math.max(1.5, (v / max) * H)} width={Math.max(0.6, bw - 0.5)} height={Math.max(1.5, (v / max) * H)} className={inActive ? 'cov-on' : 'cov-off'} /> : null;
        })}
      </svg>
      <figcaption className="muted small">
        <span>{label(monthly.firstMonth)}</span>
        <span>Music plays per month (UTC){active.trimmed ? ' · faded bars are outside the default range' : ''}</span>
        <span>{label(monthly.firstMonth + c.length - 1)}</span>
      </figcaption>
    </figure>
  );
}

export function AuditPanel({ audit, demo, active, rangeIsDefault, onFullHistory, onActiveRange }: {
  audit: ImportAudit; demo: boolean; active: ActiveRange; rangeIsDefault: 'active' | 'full' | 'custom';
  onFullHistory: () => void; onActiveRange: () => void;
}) {
  const ym = (ord: number) => new Date(monthStart(ord)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const excludedCount = REASONS.reduce((a, [k]) => a + audit.excluded[k].count, 0);
  return (
    <section className="card audit" aria-labelledby="audit-title">
      <h2 id="audit-title" className="sr-only">Import summary</h2>
      {demo && <p className="demo-banner">Synthetic demo data: invented artists, not a real listening history.</p>}
      <div className="stats">
        <div className="stat"><span className="stat-label">Music plays accepted</span><span className="stat-value" data-testid="stat-plays">{fmtInt(audit.acceptedMusic.count)}</span></div>
        <div className="stat"><span className="stat-label">Listening time</span><span className="stat-value" data-testid="stat-hours">{fmtHours(audit.acceptedMusic.ms)}</span></div>
        <div className="stat"><span className="stat-label">Date range (UTC)</span><span className="stat-value stat-small" data-testid="stat-range">{audit.firstPlay !== null ? `${fmtDate(audit.firstPlay)} to ${fmtDate(audit.lastPlay!)}` : '–'}</span></div>
        <div className="stat"><span className="stat-label">Artists · tracks</span><span className="stat-value stat-small">{fmtInt(audit.artistCount)} · {fmtInt(audit.trackCount)}</span></div>
      </div>
      <CoverageStrip monthly={audit.monthly} active={active} />
      {active.trimmed && (
        <p className="range-note small" data-testid="range-note">
          {active.leading > 0 && <>Your earliest {fmtInt(active.leading)} play{active.leading === 1 ? '' : 's'} (from {fmtDate(audit.firstPlay!)}) {active.leading === 1 ? 'is' : 'are'} isolated from your regular listening, which starts in <b>{ym(active.fromMonth)}</b>. </>}
          {active.trailing > 0 && <>{fmtInt(active.trailing)} isolated play{active.trailing === 1 ? '' : 's'} after <b>{ym(active.toMonth)}</b>. </>}
          {rangeIsDefault === 'active'
            ? <>The charts start at regular listening; those plays are still counted in the audit. <button type="button" className="link" onClick={onFullHistory}>Show full history</button></>
            : <button type="button" className="link" onClick={onActiveRange}>Start at regular listening ({ym(active.fromMonth)})</button>}
        </p>
      )}
      <details className="audit-details">
        <summary>Import details · {fmtInt(excludedCount)} of {fmtInt(audit.recordsRead)} records were not music or invalid</summary>
        <p className="muted small">Counts above are before the minimum-play filter.</p>
        <div className="audit-grid">
          <table className="mini-table" data-testid="audit-excluded">
            <caption>Records not counted as music</caption>
            <thead><tr><th scope="col">Reason</th><th scope="col">Records</th><th scope="col">Time</th></tr></thead>
            <tbody>
              {REASONS.map(([k, label]) => (
                <tr key={k} data-reason={k}><th scope="row">{label}</th><td>{fmtInt(audit.excluded[k].count)}</td><td>{fmtHours(audit.excluded[k].ms)}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="mini-table">
            <caption>Files</caption>
            <thead><tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Records</th><th scope="col">Music plays (UTC dates)</th></tr></thead>
            <tbody>
              {audit.files.map((f, i) => (
                <tr key={i} title={f.note}>
                  <th scope="row" className="file-name">{f.name}</th>
                  <td><span className={`chip chip-${f.status}`}>{STATUS_LABEL[f.status]}</span>{f.note && <small className="block muted">{f.note}</small>}</td>
                  <td>{f.records ? fmtInt(f.records) : ''}</td>
                  <td>{f.firstPlay !== undefined ? <>{fmtInt(f.musicPlays ?? 0)} · {fmtDate(f.firstPlay)} to {fmtDate(f.lastPlay!)}</> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {audit.nameVariants.length > 0 && (
          <div className="variants">
            <h4>Possible spelling variants (not merged)</h4>
            <p className="muted small">Artists are grouped by the exact name in the export. These names differ only by case, accents, punctuation or a leading “The”. They may be the same artist or different ones.</p>
            <ul>{audit.nameVariants.slice(0, 30).map((g) => <li key={g.join('|')}>{g.join(' · ')}</li>)}</ul>
            {audit.nameVariants.length > 30 && <p className="muted small">…and {audit.nameVariants.length - 30} more groups.</p>}
          </div>
        )}
        <p className="muted small">
          Artist is Spotify’s <code>master_metadata_album_artist_name</code> field (the album artist). Featured artists are not listed separately.
          Duplicate files are detected by identical content. Records are removed as duplicates only when every field matches a record in a different file.
          Repeats inside one file are kept as real, repeated listens.
        </p>
      </details>
    </section>
  );
}
