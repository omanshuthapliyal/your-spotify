import { useMemo, useState } from 'react';
import type { Kind, TableResult, TableRow } from '../worker/engine';
import { fmtDate, fmtHours, fmtInt } from './format';

type Col = { key: keyof TableRow | 'rank'; label: string; num?: boolean; render?: (r: TableRow) => string };

const COLS: Record<Kind, Col[]> = {
  artist: [
    { key: 'name', label: 'Artist' }, { key: 'ms', label: 'Listening', num: true }, { key: 'share', label: 'Share', num: true },
    { key: 'plays', label: 'Plays', num: true }, { key: 'distinctTracks', label: 'Tracks', num: true }, { key: 'first', label: 'First played' },
    { key: 'last', label: 'Last played' }, { key: 'peak', label: 'Peak' }, { key: 'genre', label: 'Genre' }, { key: 'year', label: 'Formed', num: true },
  ],
  album: [
    { key: 'name', label: 'Album' }, { key: 'sub', label: 'Artist' }, { key: 'ms', label: 'Listening', num: true },
    { key: 'plays', label: 'Album listens', num: true }, { key: 'trackPlays', label: 'Track plays', num: true },
    { key: 'distinctTracks', label: 'Tracks', num: true }, { key: 'year', label: 'Released', num: true }, { key: 'peak', label: 'Peak' },
    { key: 'first', label: 'First played' }, { key: 'genre', label: 'Genre' },
  ],
  track: [
    { key: 'name', label: 'Track' }, { key: 'sub', label: 'Artist' }, { key: 'ms', label: 'Listening', num: true }, { key: 'plays', label: 'Plays', num: true },
    { key: 'first', label: 'First played' }, { key: 'last', label: 'Last played' }, { key: 'peak', label: 'Peak' }, { key: 'genre', label: 'Genre' },
  ],
  genre: [
    { key: 'name', label: 'Genre' }, { key: 'ms', label: 'Listening', num: true }, { key: 'share', label: 'Share', num: true },
    { key: 'plays', label: 'Plays', num: true }, { key: 'first', label: 'First played' }, { key: 'peak', label: 'Peak' },
  ],
  branch: [],
};

function cell(c: Col, r: TableRow): string {
  const v = r[c.key as keyof TableRow];
  if (c.key === 'ms') return fmtHours(r.ms);
  if (c.key === 'share') return `${(r.share * 100).toFixed(1)}%`;
  if (c.key === 'plays') return Number.isInteger(r.plays) ? fmtInt(r.plays) : r.plays.toFixed(1);
  if (c.key === 'trackPlays') return fmtInt(Math.round(r.trackPlays));
  if (c.key === 'first' || c.key === 'last') return Number.isFinite(v as number) ? fmtDate(v as number) : '';
  if (c.key === 'year') return r.year ? String(r.year) : '';
  return String(v ?? '');
}

export function DataGrid({ kind, table, onOpen }: { kind: Kind; table: TableResult; onOpen: (id: number, row: TableRow) => void }) {
  const cols = COLS[kind];
  const [sort, setSort] = useState<{ key: keyof TableRow; dir: 1 | -1 }>({ key: 'ms', dir: -1 });
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const rank = useMemo(() => new Map(table.rows.map((r, i) => [r.id, i + 1])), [table]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = needle ? table.rows.filter((r) => `${r.name} ${r.sub} ${r.genre}`.toLowerCase().includes(needle)) : table.rows;
    const k = sort.key;
    return [...f].sort((a, b) => {
      const x = a[k] ?? '';
      const y = b[k] ?? '';
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir || a.id - b.id;
      return String(x).localeCompare(String(y)) * sort.dir || a.id - b.id;
    });
  }, [table, q, sort]);
  return (
    <div className="grid-wrap">
      <div className="grid-tools">
        <input type="search" placeholder={`Search ${table.rows.length} ${kind}s…`} value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} aria-label="Search table" />
        <span className="muted small">{fmtInt(table.total)} {kind}s with listening in range{table.total > table.rows.length ? `; top ${fmtInt(table.rows.length)} shown` : ''}</span>
      </div>
      <div className="table-scroll grid-scroll" tabIndex={0}>
        <table className="data-table grid" data-testid="data-grid">
          <thead>
            <tr>
              <th scope="col">#</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={c.num ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="sort" onClick={() => setSort((s) => ({ key: c.key as keyof TableRow, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : (c.num || c.key === 'first' || c.key === 'last' ? -1 : 1) }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} className="grid-row" tabIndex={0} onClick={() => onOpen(r.id, r)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id, r); }}>
                <td className="num muted">{rank.get(r.id)}</td>
                {cols.map((c) => <td key={c.key} className={c.num ? 'num' : c.key === 'name' ? 'name' : ''}>{cell(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="btn ghost more" onClick={() => setLimit((l) => l + 100)}>Show more ({fmtInt(rows.length - limit)} left)</button>}
    </div>
  );
}
