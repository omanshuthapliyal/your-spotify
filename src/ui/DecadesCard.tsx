import { useState } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { DecadeBucket } from '../core/years';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { useWidth } from './useWidth';
import { Segmented } from './Controls';
import type { Theme } from './theme';
import { fmtHours, fmtInt } from './format';

interface Props {
  client: WorkerClient;
  theme: Theme;
  settings: AggregateSettings;
  scope: string | null;
  context?: string;
  available: boolean;
  version: number;
}

export function DecadesCard({ client, theme, settings, scope, context, available, version }: Props) {
  const [by, setBy] = useState<'album' | 'artist'>('album');
  const [ref, width] = useWidth<HTMLDivElement>();
  const { data } = useWorkerQuery<DecadeBucket[]>(client, () => (available ? [{ type: 'decades', query: { settings, kind: 'artist', scope }, by }] : null), [client, settings, scope, by, available, version]);
  const buckets = data ?? [];
  const total = buckets.reduce((a, b) => a + b.ms, 0);
  const unknown = buckets.find((b) => b.decade === null);
  const known = buckets.filter((b) => b.decade !== null);
  const max = Math.max(1, ...buckets.map((b) => b.ms));
  const H = 180;
  const M = { top: 20, bottom: 30, left: 8, right: 8 };
  const inner = Math.max(10, width - M.left - M.right);
  const cols = known.length + (unknown ? 1.5 : 0);
  const bw = inner / Math.max(1, cols);
  return (
    <section className="card" data-testid="decades-card">
      <header className="chart-head">
        <div>
          <h2 className="chart-title">{context ? `${context}: listening` : 'Listening'} by {by === 'album' ? 'album release' : 'artist formation'} decade</h2>
          <p className="muted small chart-note">
            {by === 'album' ? 'Original release year of the album (earliest release on MusicBrainz, so remasters count as the original).' : 'Year the band formed or the artist was born, from MusicBrainz.'}
            {' '}Years are not in the Spotify export. {unknown && total > 0 && <>“Unknown” ({((unknown.ms / total) * 100).toFixed(0)}%) is listening whose {by} has no year yet.</>}
          </p>
        </div>
        <Segmented<'album' | 'artist'> label="Decade of" value={by} onChange={setBy} options={[['album', 'Album release'], ['artist', 'Artist formed']]} />
      </header>
      <div ref={ref}>
        {!available ? (
          <p className="muted">No year data loaded. Run <code>npm run enrich -- --zip ~/Downloads/my_spotify_data.zip</code> and rebuild to add release and formation years.</p>
        ) : !buckets.length ? <p className="muted">Preparing…</p> : (
          <svg width={width} height={H + M.top + M.bottom} viewBox={`0 0 ${width} ${H + M.top + M.bottom}`} role="img" aria-label={`Listening by ${by} decade: ${buckets.map((b) => `${b.label} ${fmtHours(b.ms)}`).join(', ')}`} fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif">
            <g transform={`translate(${M.left},${M.top})`}>
              {[...known, ...(unknown ? [unknown] : [])].map((b, i) => {
                const x = (b.decade === null ? known.length + 0.5 : i) * bw;
                const h = (b.ms / max) * H;
                return (
                  <g key={b.label} data-decade={b.label}>
                    <rect x={x + bw * 0.12} y={H - h} width={bw * 0.76} height={Math.max(b.ms > 0 ? 1 : 0, h)} rx={4} fill={b.decade === null ? theme.unclassified : theme.series[0]}>
                      <title>{`${b.label}: ${fmtHours(b.ms)} · ${fmtInt(b.items)} ${by}s · ${total ? ((b.ms / total) * 100).toFixed(1) : 0}%`}</title>
                    </rect>
                    {h > 16 && bw > 34 && <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize={10.5} fill={theme.ink2}>{total ? `${Math.round((b.ms / total) * 100)}%` : ''}</text>}
                    <text x={x + bw / 2} y={H + 16} textAnchor="middle" fontSize={11} fill={theme.muted}>{bw < 34 && b.decade !== null ? `'${String(b.decade).slice(2, 3)}0` : b.label}</text>
                  </g>
                );
              })}
              <line x1={0} x2={inner} y1={H} y2={H} stroke={theme.axis} />
            </g>
          </svg>
        )}
      </div>
    </section>
  );
}
