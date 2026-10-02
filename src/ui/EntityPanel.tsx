import { useEffect } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { EntityInfo, Kind } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import type { Theme } from './theme';
import { fmtDate, fmtHours, fmtInt } from './format';
import { Cover } from './Cover';
import { LIFE_INFO } from './PatternsView';

export type EntityRef = { kind: 'artist' | 'album' | 'track'; id: number };

interface Props {
  client: WorkerClient;
  theme: Theme;
  settings: AggregateSettings;
  entity: EntityRef;
  version: number;
  timeZone: string;
  onOpen: (e: EntityRef) => void;
  onOpenBranch: (nodeId: string) => void;
  onClose: () => void;
  onBack?: () => void;
}

const KIND_LABEL: Record<Kind, string> = { artist: 'Artist', album: 'Album', track: 'Track', genre: 'Genre', branch: 'Branch' };

function MiniBars({ info, theme, height = 90 }: { info: EntityInfo; theme: Theme; height?: number }) {
  const W = 440;
  const P = info.periods.length;
  const max = Math.max(1, ...info.periods.map((p) => p.ms));
  const bw = W / Math.max(1, P);
  return (
    <>
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="mini-bars" style={{ height }} role="img" aria-label={`Listening per period from ${info.periods[0]?.label} to ${info.periods[P - 1]?.label}; peak ${info.peak ?? 'none'}`}>
      {info.periods.map((p, i) => {
        const h = (p.ms / max) * height;
        return (
          <rect key={i} x={i * bw + 0.5} y={height - h} width={Math.max(0.8, bw - 1)} height={Math.max(p.ms > 0 ? 1 : 0, h)} rx={1} fill={p.label === info.peak ? theme.series[1] : theme.series[0]}>
            <title>{`${p.label}: ${fmtHours(p.ms)}`}</title>
          </rect>
        );
      })}
      <line x1={0} x2={W} y1={height} y2={height} stroke={theme.axis} vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="mini-axis"><span>{info.periods[0]?.label}</span>{info.peak && <span>peak {info.peak}</span>}<span>{info.periods[P - 1]?.label}</span></div>
    </>
  );
}

function RankList({ title, rows, onClick }: { title: string; rows: EntityInfo['topTracks']; onClick?: (id: number) => void }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ol className="rank-list">
        {rows.map((r, i) => (
          <li key={i}>
            {onClick && r.id !== undefined
              ? <button type="button" className="rank-name link-like" onClick={() => onClick(r.id!)}>{r.name}{r.sub && <small>{r.sub}</small>}</button>
              : <span className="rank-name">{r.name}{r.sub && <small>{r.sub}</small>}</span>}
            <span className="rank-val">{fmtHours(r.ms)} · {Number.isInteger(r.plays) ? fmtInt(r.plays) : r.plays.toFixed(1)} plays</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EntityPanel({ client, theme, settings, entity, version, timeZone, onOpen, onOpenBranch, onClose, onBack }: Props) {
  const { data: info, stale } = useWorkerQuery<EntityInfo>(client, () => [{ type: 'entity', kind: entity.kind, entityId: entity.id, settings, timeZone }], [client, entity.kind, entity.id, settings, version, timeZone]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <aside className={`drawer${stale ? ' stale' : ''}`} role="dialog" aria-modal="false" aria-labelledby="entity-title" data-testid="entity-panel">
      <header className="drawer-head">
        <div className="drawer-id">
          {info && <Cover src={info.art} name={info.title} size={88} round={entity.kind === 'artist'} title={entity.kind === 'artist' && info.art ? 'Cover of their most-played album' : undefined} />}
          <div>
            <span className="chip">{KIND_LABEL[entity.kind]}</span>
            <h3 id="entity-title">{info?.title ?? '…'}</h3>
            {info?.sub && <p className="muted">{info.sub}</p>}
          </div>
        </div>
        <div className="drawer-actions">
          {onBack && <button type="button" className="btn ghost" onClick={onBack}>← Back</button>}
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close details">Close</button>
        </div>
      </header>
      {info && (
        <div className="drawer-body">
          <div className="mini-stats">
            <div><span className="stat-label">Listening</span><b>{fmtHours(info.ms)}</b></div>
            <div><span className="stat-label">Share</span><b>{(info.share * 100).toFixed(1)}%</b></div>
            {info.albumListens !== undefined
              ? <>
                <div title="Sittings (no gap over 30 min) with at least 3 different tracks of this album"><span className="stat-label">Album listens</span><b data-testid="album-listens">{info.albumListens ? fmtInt(info.albumListens) : '–'}</b></div>
                <div><span className="stat-label">Track plays</span><b>{fmtInt(info.plays)}</b></div>
              </>
              : <div><span className="stat-label">Times played</span><b>{fmtInt(info.plays)}</b></div>}
            {info.rank && <div><span className="stat-label">Rank</span><b>#{fmtInt(info.rank)}</b></div>}
          </div>
          <ul className="history" data-testid="entity-history">
            {info.discovered != null && <li><span>Discovered</span><b>{fmtDate(info.discovered)}</b></li>}
            {info.last !== null && <li><span>Last played</span><b>{fmtDate(info.last)}</b></li>}
            {info.bestMonth && <li><span>Best month</span><b>{info.bestMonth.label} · {fmtHours(info.bestMonth.ms)}</b></li>}
            {info.longestStreakDays ? <li><span>Longest streak</span><b>{info.longestStreakDays} day{info.longestStreakDays === 1 ? '' : 's'} in a row</b></li> : null}
            {info.yearsPlayed ? <li><span>Years played</span><b>{info.yearsPlayed}</b></li> : null}
          </ul>
          {info.meta.length > 0 && <p className="muted small">{info.meta.join(' · ')}</p>}
          {info.lifecycle && <p className="small" data-testid="entity-lifecycle"><span className="chip">{LIFE_INFO[info.lifecycle][0]}</span> <span className="muted">{LIFE_INFO[info.lifecycle][1]}</span></p>}
          <MiniBars info={info} theme={theme} />
          {info.genres.length > 0 && (
            <p className="chips">
              {info.genres.map((g) => <button key={g} type="button" className="chip chip-btn" onClick={() => onOpenBranch(`g:${g.toLowerCase()}`)}>{g}</button>)}
            </p>
          )}
          <div className="drawer-lists">
            {entity.kind !== 'track' && <RankList title="Top tracks" rows={info.topTracks} onClick={(id) => onOpen({ kind: 'track', id })} />}
            {entity.kind === 'artist' && <RankList title="Top albums" rows={info.topAlbums} onClick={(id) => onOpen({ kind: 'album', id })} />}
            {entity.kind !== 'artist' && <RankList title="Artist" rows={info.topArtists.slice(0, 1)} onClick={(id) => onOpen({ kind: 'artist', id })} />}
            {entity.kind === 'track' && <RankList title="Album" rows={info.topAlbums.slice(0, 3)} onClick={(id) => onOpen({ kind: 'album', id })} />}
            {info.alongside && info.alongside.length > 0 && (
              <div data-testid="alongside">
                <h4>Often played alongside</h4>
                <ol className="rank-list">
                  {info.alongside.map((n) => (
                    <li key={n.id}>
                      <button type="button" className="rank-name link-like" onClick={() => onOpen({ kind: 'artist', id: n.id })}>{n.name}</button>
                      <span className="rank-val">{fmtInt(n.together)} sessions together</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
