import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { fmtHours } from './format';
import { Cover } from './Cover';

/** Header search across artists, albums, songs and genres; Enter opens the first result. */
export function SearchBox({ client, version, onPick }: { client: WorkerClient; version: number; onPick: (h: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      client.request<SearchHit[]>({ type: 'search', q }).then((h) => { if (n === seq.current) { setHits(h); setActive(0); } }).catch(() => undefined);
    }, 120);
    return () => clearTimeout(t);
  }, [client, q, version]);
  const pick = (h: SearchHit) => { onPick(h); setOpen(false); setQ(''); };
  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        type="search"
        placeholder="Search artists, albums, songs, genres…"
        aria-label="Search your library"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && hits[active]) pick(hits[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul className="search-results" role="listbox" data-testid="search-results">
          {hits.map((h, i) => (
            <li key={`${h.kind}${h.id}`} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                {h.kind !== 'genre' && <Cover src={h.art} name={h.name} size={30} round={h.kind === 'artist'} />}
                <span className="sr-name">{h.name}<small>{h.sub}</small></span>
                <span className="sr-val">{fmtHours(h.ms)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
