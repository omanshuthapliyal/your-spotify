import type { AggregateSettings } from '../core/aggregate';
import type { Kind, TableResult } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { fmtHours } from './format';
import { Cover } from './Cover';

type Section = 'artists' | 'albums' | 'tracks' | 'genres';

function TopList({ client, settings, kind, title, version, onOpen, onMore }: {
  client: WorkerClient; settings: AggregateSettings; kind: Kind; title: string; version: number;
  onOpen: (id: number, name: string) => void; onMore: () => void;
}) {
  const { data } = useWorkerQuery<TableResult>(client, () => [{ type: 'table', query: { settings, kind }, limit: 5 }], [client, settings, kind, version]);
  return <TopListCard kind={kind} title={title} rows={data?.rows ?? []} onOpen={onOpen} onMore={onMore} />;
}

/** Pure top-5 card (also used by the shareable report). */
export function TopListCard({ kind, title, rows, onOpen, onMore }: {
  kind: Kind; title: string; rows: TableResult['rows']; onOpen?: (id: number, name: string) => void; onMore?: () => void;
}) {
  return (
    <section className="card top-card" data-testid={`top-${kind}`}>
      <header className="top-head"><h3>{title}</h3>{onMore && <button type="button" className="link" onClick={onMore}>See all</button>}</header>
      <ol className="rank-list">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>
            {kind !== 'genre' && <Cover src={r.art} name={r.name} size={32} round={kind === 'artist'} />}
            {onOpen
              ? <button type="button" className="rank-name link-like" onClick={() => onOpen(r.id, r.name)}>{r.name}{r.sub && <small>{r.sub}</small>}</button>
              : <span className="rank-name">{r.name}{r.sub && <small>{r.sub}</small>}</span>}
            <span className="rank-val">{fmtHours(r.ms)}{kind === 'track' ? ` · ${Math.round(r.plays)}×` : kind === 'album' ? (r.plays > 0 ? ` · ${Math.round(r.plays)} listens` : '') : ` · ${(r.share * 100).toFixed(0)}%`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TopLists({ client, settings, version, hasGenres, onOpenEntity, onOpenBranch, onSection }: {
  client: WorkerClient; settings: AggregateSettings; version: number; hasGenres: boolean;
  onOpenEntity: (kind: 'artist' | 'album' | 'track', id: number) => void; onOpenBranch: (id: string) => void; onSection: (s: Section) => void;
}) {
  return (
    <div className="top-grid">
      <TopList client={client} settings={settings} kind="artist" title="Top artists" version={version} onOpen={(id) => onOpenEntity('artist', id)} onMore={() => onSection('artists')} />
      <TopList client={client} settings={settings} kind="album" title="Top albums" version={version} onOpen={(id) => onOpenEntity('album', id)} onMore={() => onSection('albums')} />
      <TopList client={client} settings={settings} kind="track" title="Top songs" version={version} onOpen={(id) => onOpenEntity('track', id)} onMore={() => onSection('tracks')} />
      {hasGenres && <TopList client={client} settings={settings} kind="genre" title="Top genres" version={version} onOpen={(_, name) => onOpenBranch(`g:${name.toLowerCase()}`)} onMore={() => onSection('genres')} />}
    </div>
  );
}
