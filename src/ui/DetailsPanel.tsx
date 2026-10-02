import type { Details } from '../worker/engine';
import { fmtDate, fmtHours, fmtInt } from './format';

export function DetailsPanel({ details, onClose }: { details: Details; onClose: () => void }) {
  const showArtists = details.topArtists.length > 1;
  const plays = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(1));
  return (
    <section className="card details" aria-labelledby="details-title">
      <header className="details-head">
        <div>
          <h3 id="details-title">{details.title}</h3>
          <p className="muted">
            {details.scope} · {fmtHours(details.ms)} · {plays(details.plays)} plays
            {details.firstPlay !== null && details.lastPlay !== null && ` · ${fmtDate(details.firstPlay)} to ${fmtDate(details.lastPlay)} UTC`}
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close details">Close</button>
      </header>
      <div className={`details-grid${showArtists ? '' : ' single'}`}>
        <div>
          <h4>Top tracks</h4>
          <ol className="rank-list">
            {details.topTracks.map((t, i) => (
              <li key={i}><span className="rank-name">{t.name}<small>{t.sub}</small></span><span className="rank-val">{fmtHours(t.ms)} · {plays(t.plays)}</span></li>
            ))}
          </ol>
        </div>
        {details.topAlbums && details.topAlbums.length > 0 && (
          <div>
            <h4>Top albums</h4>
            <ol className="rank-list">
              {details.topAlbums.slice(0, 6).map((t, i) => (
                <li key={i}><span className="rank-name">{t.name}<small>{t.sub}</small></span><span className="rank-val">{fmtHours(t.ms)} · {plays(t.plays)}</span></li>
              ))}
            </ol>
          </div>
        )}
        {showArtists && (
          <div>
            <h4>Top artists</h4>
            <ol className="rank-list">
              {details.topArtists.map((t, i) => (
                <li key={i}><span className="rank-name">{t.name}</span><span className="rank-val">{fmtHours(t.ms)} · {plays(t.plays)}</span></li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
