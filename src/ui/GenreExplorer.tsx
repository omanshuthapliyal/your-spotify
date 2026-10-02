import { useMemo, useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { EntityInfo, TreeNodeSummary } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import type { Theme } from './theme';
import { ExploreView, type ChartOptions, type ViewKind } from './ExploreView';
import { DecadesCard } from './DecadesCard';
import { fmtDate, fmtHours, fmtInt } from './format';

type Lens = 'branches' | 'artist' | 'album' | 'track' | 'decades';
const LENS_VIEWS: Record<Exclude<Lens, 'decades'>, ViewKind[]> = {
  branches: ['timeline', 'eras', 'ranks'],
  artist: ['list', 'timeline', 'eras', 'ranks'],
  album: ['list', 'whole', 'timeline', 'eras'],
  track: ['list', 'eras', 'timeline'],
};
const LENS_LIST: Record<Exclude<Lens, 'decades'>, string | undefined> = { branches: undefined, artist: 'Top artists', album: 'Top albums', track: 'Top songs' };

interface Props {
  client: WorkerClient;
  theme: Theme;
  settings: AggregateSettings;
  version: number;
  node: string;
  onNode: (id: string) => void;
  opts: ChartOptions;
  onOpts: (o: ChartOptions) => void;
  onOpenEntity: (kind: 'artist' | 'album' | 'track', id: number) => void;
  yearsAvailable: boolean;
  mbEdges: number;
  exportNotes: string[];
  timeZone: string;
}

function TreeRow({ id, depth, nodes, expanded, toggle, selected, onSelect, path }: {
  id: string; depth: number; nodes: Map<string, TreeNodeSummary>; expanded: Set<string>; toggle: (k: string) => void;
  selected: string; onSelect: (id: string) => void; path: string;
}) {
  const n = nodes.get(id);
  if (!n || n.ms <= 0) return null;
  const kids = n.children.map((c) => nodes.get(c)!).filter((c) => c && c.ms > 0).sort((a, b) => b.ms - a.ms);
  const key = `${path}/${id}`;
  const open = expanded.has(key);
  return (
    <li>
      <div className={`tree-row${selected === id ? ' selected' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
        {kids.length ? (
          <button type="button" className="caret" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${n.label}`} onClick={() => toggle(key)}>{open ? '▾' : '▸'}</button>
        ) : <span className="caret" />}
        <button type="button" className="tree-label" onClick={() => onSelect(id)} data-node={id}>
          <span className={n.kind === 'style' ? 'style-name' : ''}>{n.label}</span>
          <span className="tree-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, n.share * 100)}%` }} /></span>
          <span className="tree-val">{fmtHours(n.ms)}</span>
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul>{kids.map((k) => <TreeRow key={k.id} id={k.id} depth={depth + 1} nodes={nodes} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} path={key} />)}</ul>
      )}
    </li>
  );
}

export function GenreExplorer(p: Props) {
  const { client, settings, node } = p;
  const [lens, setLens] = useState<Lens>('branches');
  const [views, setViews] = useState<Record<Exclude<Lens, 'decades'>, ViewKind>>({ branches: 'timeline', artist: 'list', album: 'list', track: 'list' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const { data: tree } = useWorkerQuery<TreeNodeSummary[]>(client, () => [{ type: 'tree', settings }], [client, settings, p.version]);
  const { data: info } = useWorkerQuery<EntityInfo>(client, () => [{ type: 'entity', kind: 'genre', entityId: node, settings }], [client, node, settings, p.version]);
  const nodes = useMemo(() => new Map((tree ?? []).map((n) => [n.id, n])), [tree]);
  const root = nodes.get('root');
  const toggle = (k: string) => setExpanded((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const matches = filter.trim() ? (tree ?? []).filter((n) => n.id !== 'root' && n.ms > 0 && n.label.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => b.ms - a.ms) : null;
  const selected = nodes.get(node);
  const isRoot = node === 'root';
  const label = selected?.label ?? 'All genres';
  const hasKids = (selected?.children.length ?? 0) > 0 || isRoot;
  const lensValue: Lens = !hasKids && lens === 'branches' ? 'artist' : lens;

  return (
    <div className="genre-explorer">
      <aside className="card tree-card" aria-label="Genre tree">
        <h2 className="chart-title">Genre tree</h2>
        <details className="tree-help muted small">
          <summary>How the tree is built</summary>
          {p.mbEdges ? 'Branches follow MusicBrainz “subgenre of / fusion of” links' : 'No MusicBrainz tree loaded; branches are'}, plus <span className="style-name">style branches</span> (italic) grouping genres that share a name word, like “Progressive”. A genre can sit in several branches; each play still counts once per branch.
        </details>
        <input type="search" placeholder="Find a genre…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a genre" />
        <ul className="tree">
          <li>
            <div className={`tree-row${isRoot ? ' selected' : ''}`}>
              <span className="caret" />
              <button type="button" className="tree-label" onClick={() => p.onNode('root')} data-node="root">
                <span>All genres</span><span className="tree-bar"><span style={{ width: `${(root?.share ?? 0) * 100}%` }} /></span><span className="tree-val">{root ? fmtHours(root.ms) : ''}</span>
              </button>
            </div>
          </li>
          {matches
            ? matches.slice(0, 60).map((n) => (
              <li key={n.id}><div className={`tree-row${node === n.id ? ' selected' : ''}`}><span className="caret" />
                <button type="button" className="tree-label" onClick={() => p.onNode(n.id)} data-node={n.id}><span className={n.kind === 'style' ? 'style-name' : ''}>{n.label}</span><span className="tree-bar"><span style={{ width: `${Math.max(2, n.share * 100)}%` }} /></span><span className="tree-val">{fmtHours(n.ms)}</span></button>
              </div></li>))
            : (['genre', 'style'] as const).map((k) => {
              const kids = (root?.children ?? []).map((c) => nodes.get(c)!).filter((c) => c && c.ms > 0 && c.kind === k).sort((a, b) => b.ms - a.ms);
              if (!kids.length) return null;
              return (
                <li key={k} className="tree-group">
                  <div className="tree-group-label">{k === 'genre' ? 'Genres' : 'Styles (by name, overlap the genres)'}</div>
                  <ul>{kids.map((c) => <TreeRow key={c.id} id={c.id} depth={0} nodes={nodes} expanded={expanded} toggle={toggle} selected={node} onSelect={p.onNode} path="" />)}</ul>
                </li>
              );
            })}
        </ul>
      </aside>

      <div className="genre-main">
        <section className="card branch-head" data-testid="branch-head">
          <nav className="crumbs" aria-label="Branch path">
            {info?.path?.map((x, i) => (
              <span key={x.id}>{i > 0 && ' › '}<button type="button" className="link" onClick={() => p.onNode(x.id)}>{x.label}</button></span>
            ))}
          </nav>
          <h2 className="branch-title">{label}</h2>
          {info && (
            <>
              <p className="branch-facts">
                <b data-testid="branch-hours">{fmtHours(info.ms)}</b> · {(info.share * 100).toFixed(1)}% of your listening
                {selected && !isRoot && <> · {fmtInt(selected.artists)} artists</>}
                {info.first && <> · since {fmtDate(info.first).slice(0, 4)}</>}
                {info.peak && <> · peak {info.peak}</>}
              </p>
              {isRoot && root?.classifiedMs !== undefined && root.ms > 0 && (
                <p className="muted small" data-testid="genre-coverage-note">
                  {Math.round((root.classifiedMs / root.ms) * 100)}% of your listening has a genre. The rest is <b>Unclassified</b>: artists MusicBrainz has no genre for, or outside the artists that were looked up.
                </p>
              )}
              {info.children && info.children.length > 0 && (
                <p className="chips">{info.children.slice(0, 10).map((c) => (
                  <button key={c.id} type="button" className={`chip chip-btn${c.kind === 'style' ? ' style-name' : ''}`} onClick={() => p.onNode(c.id)}>{c.label} · {fmtHours(c.ms)}</button>
                ))}</p>
              )}
            </>
          )}
          <div className="tabs lens-tabs" role="tablist" aria-label="Look at">
            {([...(hasKids ? [['branches', 'Sub-genres']] : []), ['artist', 'Artists'], ['album', 'Albums'], ['track', 'Songs'], ['decades', 'Decades']] as Array<[Lens, string]>).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={lensValue === k} className={lensValue === k ? 'on' : ''} onClick={() => setLens(k)}>{l}</button>
            ))}
          </div>
        </section>

        {lensValue === 'decades' ? (
          <DecadesCard client={client} theme={p.theme} settings={settings} scope={isRoot ? null : node} context={isRoot ? undefined : label} available={p.yearsAvailable} version={p.version} />
        ) : (
        <ExploreView
          key={`${node}-${lensValue}`}
          client={client}
          theme={p.theme}
          settings={settings}
          kind={lensValue === 'branches' ? 'branch' : lensValue}
          scope={lensValue === 'branches' || isRoot ? null : node}
          branch={lensValue === 'branches' ? node : null}
          context={isRoot ? undefined : label}
          views={LENS_VIEWS[lensValue]}
          listLabel={LENS_LIST[lensValue]}
          view={views[lensValue]}
          onView={(v) => setViews((s) => ({ ...s, [lensValue]: v }))}
          opts={p.opts}
          onOpts={p.onOpts}
          onOpenEntity={p.onOpenEntity}
          onOpenBranch={p.onNode}
          exportNotes={p.exportNotes}
          version={p.version}
          timeZone={p.timeZone}
          testId="genre-explore"
        />
        )}
      </div>
    </div>
  );
}
