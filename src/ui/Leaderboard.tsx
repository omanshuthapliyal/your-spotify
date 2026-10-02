import { useMemo, useState } from 'react';
import type { Kind, TableResult, TableRow } from '../worker/engine';
import { DataGrid } from './DataGrid';
import { fmtHours, fmtInt } from './format';
import { Cover } from './Cover';

export type RankBy = 'time' | 'plays';

const NOUN: Partial<Record<Kind, string>> = { artist: 'artists', album: 'albums', track: 'songs', genre: 'genres' };

/**
 * Ranked list with both measures side by side. "Times played" = plays at or above the minimum
 * play duration (the export cannot tell a full listen from a long partial one).
 */
export function Leaderboard({ kind, table, minSeconds, by, onOpen }: {
  kind: Kind; table: TableResult; minSeconds: number; by: RankBy; onOpen: (id: number, row: TableRow) => void;
}) {
  const album = kind === 'album';
  const playsLabel = album ? 'Album listens' : 'Times played';
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const [full, setFull] = useState(false);
  const noun = NOUN[kind] ?? 'items';

  const { byTime, byPlays } = useMemo(() => {
    const t = [...table.rows].sort((a, b) => b.ms - a.ms || a.id - b.id);
    const p = [...table.rows].sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.id - b.id);
    return { byTime: new Map(t.map((r, i) => [r.id, i + 1])), byPlays: new Map(p.map((r, i) => [r.id, i + 1])) };
  }, [table]);
  const maxMs = Math.max(1, ...table.rows.map((r) => r.ms));
  const maxPlays = Math.max(1, ...table.rows.map((r) => r.plays));
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = needle ? table.rows.filter((r) => `${r.name} ${r.sub}`.toLowerCase().includes(needle)) : table.rows;
    const rank = by === 'time' ? byTime : byPlays;
    return [...f].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }, [table, q, by, byTime, byPlays]);

  if (full) {
    return (
      <div>
        <button type="button" className="link" onClick={() => setFull(false)}>← Simple list</button>
        <DataGrid kind={kind} table={table} onOpen={onOpen} />
      </div>
    );
  }
  const plays = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(1));
  return (
    <div className="board" data-testid="leaderboard">
      <div className="board-tools">
        <input type="search" placeholder={`Search ${noun}…`} value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} aria-label={`Search ${noun}`} />
        <button type="button" className="link" onClick={() => setFull(true)}>More columns</button>
      </div>
      <ol className="board-list">
        <li className="board-head" aria-hidden="true">
          <span>#</span><span>{kind === 'track' ? 'Song' : kind === 'album' ? 'Album' : kind === 'artist' ? 'Artist' : 'Name'}</span>
          <span className={by === 'time' ? 'on' : ''}>Listening time</span><span className={by === 'plays' ? 'on' : ''}>{playsLabel}</span>
        </li>
        {rows.slice(0, limit).map((r) => {
          const rank = by === 'time' ? byTime.get(r.id)! : byPlays.get(r.id)!;
          const other = by === 'time' ? byPlays.get(r.id)! : byTime.get(r.id)!;
          return (
            <li key={r.id}>
              <button type="button" className="board-row" onClick={() => onOpen(r.id, r)} data-testid="board-row">
                <span className="board-rank">{rank}</span>
                <span className="board-name board-name-art">
                  {kind !== 'genre' && <Cover src={r.art} name={r.name} size={38} round={kind === 'artist'} title={kind === 'artist' && r.art ? 'Cover of their most-played album' : undefined} />}
                  <span className="board-text">
                  <b>{r.name}</b>
                  {(r.sub || album) && <small>{r.sub}{album && <span data-testid="board-track-plays"> · {fmtInt(Math.round(r.trackPlays))} track plays</span>}</small>}
                  </span>
                </span>
                <span className={`board-metric${by === 'time' ? ' on' : ''}`}>
                  <span className="board-bar"><span style={{ width: `${(r.ms / maxMs) * 100}%` }} /></span>
                  <span className="board-val" data-testid="board-time">{fmtHours(r.ms)}</span>
                </span>
                <span className={`board-metric${by === 'plays' ? ' on' : ''}`}>
                  <span className="board-bar"><span style={{ width: `${(r.plays / maxPlays) * 100}%` }} /></span>
                  <span className="board-val" data-testid="board-plays">{album ? (r.plays > 0 ? `${plays(r.plays)}×` : '–') : `${plays(r.plays)}×`}</span>
                </span>

                {other !== rank && <span className="board-alt">#{other} by {by === 'time' ? (album ? 'listens' : 'plays') : 'time'}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small board-foot">
        {rows.length > limit && <button type="button" className="btn ghost" onClick={() => setLimit((l) => l + 50)}>Show more</button>}
        {' '}{fmtInt(table.total)} {noun} in range · {album
          ? <>an album listen is a sitting (no gap over 30 min) with at least 3 different tracks of the album; “–” means you never played 3 of its tracks together.</>
          : <>“times played” counts plays of at least {minSeconds} s.</>}
      </p>
    </div>
  );
}
