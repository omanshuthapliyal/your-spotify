import { useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { WholeAlbumsResult } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import type { Theme } from './theme';
import { Cover } from './Cover';
import { ColumnBars } from './InsightCharts';
import { fmtDate, fmtHours, fmtInt } from './format';

/** Albums you played front to back in one sitting. */
export function WholeAlbums({ client, theme, settings, scope, version, onOpenAlbum }: {
  client: WorkerClient; theme: Theme; settings: AggregateSettings; scope: string | null; version: number; onOpenAlbum: (id: number) => void;
}) {
  const { data, stale } = useWorkerQuery<WholeAlbumsResult>(client, () => [{ type: 'whole', settings, scope }], [client, settings, scope, version]);
  if (!data) return <p className="muted">Finding albums you played front to back…</p>;
  return <WholeAlbumsBody data={data} theme={theme} stale={stale} onOpenAlbum={onOpenAlbum} />;
}

/** Pure display of whole-album listening (also used by the shareable report). */
export function WholeAlbumsBody({ data, theme, stale = false, onOpenAlbum, dateFmt = fmtDate }: {
  data: WholeAlbumsResult; theme: Theme; stale?: boolean; onOpenAlbum?: (id: number) => void; dateFmt?: (t: number) => string;
}) {
  const [limit, setLimit] = useState(25);
  const whole = data.rows.filter((r) => r.wholeListens > 0);
  const max = Math.max(1, ...whole.map((r) => r.wholeListens));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className={`whole${stale ? ' stale' : ''}`} data-testid="whole-albums">
      <div className="istats">
        <div className="istat"><span className="stat-label">Whole-album listens</span><b data-testid="whole-total">{fmtInt(data.totalWhole)}</b><small className="muted">in the selected dates</small></div>
        <div className="istat"><span className="stat-label">Albums played front to back</span><b>{fmtInt(whole.length)}</b><small className="muted">of {fmtInt(data.albumsConsidered)} albums you sat down with</small></div>
        {whole[0] && <div className="istat"><span className="stat-label">Most complete listens</span><b>{whole[0].wholeListens}×</b><small className="muted">{whole[0].name} · {whole[0].artist}</small></div>}
      </div>
      <div className="grid2-inline">
        <div>
          <h4 className="sub-h">Whole-album listens per year</h4>
          <ColumnBars items={data.perYear.map((y) => ({ key: String(y.year), label: String(y.year), value: y.count }))} theme={theme} fmt={(v) => `${fmtInt(v)} listens`} label="Whole-album listens" height={100} />
        </div>
        <div>
          <h4 className="sub-h">How far into an album you get (sittings with 3+ of its tracks)</h4>
          <ColumnBars items={data.coverage.map((c) => ({ key: c.label, label: c.label, value: c.count }))} theme={theme} fmt={(v) => `${fmtInt(v)} sittings`} label="Sittings" height={100} />
        </div>
      </div>
      <h4 className="sub-h">Albums you listened to all the way through</h4>
      {whole.length === 0 ? <p className="muted">No album was played front to back in these dates.</p> : (
        <ol className="board-list whole-list">
          <li className="board-head whole-head" aria-hidden="true"><span>#</span><span>Album</span><span>Whole listens</span><span>Avg. completion</span><span>Last time</span></li>
          {whole.slice(0, limit).map((r, i) => (
            <li key={r.album}>
              <button type="button" className="board-row whole-row" onClick={onOpenAlbum ? () => onOpenAlbum(r.album) : undefined} data-testid="whole-row">
                <span className="board-rank">{i + 1}</span>
                <span className="board-name board-name-art">
                  <Cover src={r.art} name={r.name} size={38} />
                  <span className="board-text"><b>{r.name}</b><small>{r.artist} · {r.knownTracks} tracks you know</small></span>
                </span>
                <span className="board-metric on"><span className="board-bar"><span style={{ width: `${(r.wholeListens / max) * 100}%` }} /></span><span className="board-val">{r.wholeListens}×</span></span>
                <span className="board-val whole-cov" title={`Average share of the album covered across ${r.sittings} sittings with 3+ of its tracks`}>{pct(r.avgCoverage)} · {r.sittings} sittings</span>
                <span className="board-val">{r.lastWhole ? dateFmt(r.lastWhole) : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {whole.length > limit && <button type="button" className="btn ghost more" onClick={() => setLimit((l) => l + 50)}>Show more</button>}
      <p className="muted small">
        The export does not list album lengths, so an album’s length is the number of its tracks you have ever played (albums with fewer than 4 are left out).
        A whole-album listen is one sitting (no gap over 30 min) covering at least 80% of those tracks, with at least 80% of the plays not skipped.
        Track order is not checked. Total time in whole listens: {fmtHours(whole.reduce((a, r) => a + r.wholeMs, 0))}.
      </p>
    </div>
  );
}
