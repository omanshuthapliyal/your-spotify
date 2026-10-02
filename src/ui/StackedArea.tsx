import { forwardRef, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { area, curveLinear, curveMonotoneX } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { valueAt, METRIC_LABEL, type AggregateResult, type Metric } from '../core/aggregate';
import { seriesColor, type Theme } from './theme';
import { fmtAxis } from './format';
import { Tooltip, type HoverState } from './Tooltip';

export type Shape = 'smooth' | 'steps';
/** How the 'Other' series is drawn: mirrored below the zero line on the same scale, or not at all. */
export type OtherMode = 'below' | 'hidden';

interface Props {
  result: AggregateResult;
  metric: Metric;
  shape: Shape;
  otherMode: OtherMode;
  width: number;
  theme: Theme;
  highlight: string | null;
  onSelect: (seriesKey: string, periodIndex: number) => void;
}

interface Pt { x: number; y0: number; y1: number; defined: boolean }

const MARGIN = { top: 12, right: 16, bottom: 36, left: 52 };

export function chartHeight(width: number) {
  return Math.round(Math.max(300, Math.min(500, width * 0.48)));
}

export const StackedArea = forwardRef<SVGSVGElement, Props>(function StackedArea(
  { result, metric, shape, otherMode, width, theme, highlight, onSelect }, ref,
) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const clipId = `clip-${useId().replace(/:/g, '')}`;
  const height = chartHeight(width);
  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const P = result.periods.length;
  const bw = innerW / Math.max(1, P);

  const geo = useMemo(() => {
    const visible = result.series.filter((s) => s.kind !== 'other');
    const visibleSum = result.periods.map((p, i) => visible.reduce((a, s) => a + (valueAt(s, p, i, metric) ?? 0), 0));
    const otherS = result.series.find((s) => s.kind === 'other');
    const below = otherMode === 'below' && Boolean(otherS);
    const otherVals = result.periods.map((p, i) => (otherS ? valueAt(otherS, p, i, metric) ?? 0 : 0));
    const yMax = Math.max(1e-9, ...visibleSum);
    const yMin = below ? -Math.max(0, ...otherVals) : 0;
    const y = scaleLinear().domain([0, yMax]).range([innerH, 0]);
    y.nice(6);
    // Below-axis, same scale. The bottom fits Other (+6% headroom), keeps at least ~12% of the
    // height when Other is small, and is CLIPPED at the height of the top stack when Other is far
    // larger (e.g. albums), so the top N stay readable. Clipping is marked and labelled.
    let clippedAt: number | null = null;
    if (below) {
      const top = y.domain()[1];
      const need = -yMin * 1.06;
      const depth = Math.max(Math.min(need, top), top * 0.14);
      if (need > top) clippedAt = top;
      y.domain([-depth, top]);
    }
    // stack: series[0] at the bottom
    const cum = new Array(P).fill(0);
    const layers = visible.map((s) => {
      const vals = result.periods.map((p, i) => valueAt(s, p, i, metric));
      const pts: Array<{ i: number; v0: number; v1: number; defined: boolean }> = vals.map((v, i) => {
        const v0 = cum[i];
        cum[i] += v ?? 0;
        return { i, v0, v1: cum[i], defined: v !== null };
      });
      return { s, pts };
    });
    if (below && otherS) {
      // Other hangs below zero: same scale, drawn downward.
      layers.push({ s: otherS, pts: result.periods.map((p, i) => ({ i, v0: 0, v1: -otherVals[i], defined: valueAt(otherS, p, i, metric) !== null })) });
    }
    const gen = area<Pt>().x((d) => d.x).y0((d) => d.y0).y1((d) => d.y1).defined((d) => d.defined)
      .curve(shape === 'smooth' ? curveMonotoneX : curveLinear);
    const paths = layers.map(({ s, pts }) => {
      let line: Pt[];
      if (shape === 'steps') {
        line = pts.flatMap((p) => [
          { x: p.i * bw, y0: y(p.v0), y1: y(p.v1), defined: p.defined },
          { x: (p.i + 1) * bw, y0: y(p.v0), y1: y(p.v1), defined: p.defined },
        ]);
      } else {
        // Midpoint interpolation within each run of non-empty periods. Runs end with a vertical
        // edge at the period boundary, so no slope ever enters an empty period.
        line = [];
        const ok = (i: number) => i >= 0 && i < P && result.periods[i].ms > 0;
        for (const p of pts) {
          const pt = { y0: y(p.v0), y1: y(p.v1), defined: ok(p.i) };
          if (!pt.defined) { line.push({ ...pt, x: (p.i + 0.5) * bw }); continue; }
          if (!ok(p.i - 1)) line.push({ ...pt, x: p.i * bw });
          line.push({ ...pt, x: (p.i + 0.5) * bw });
          if (!ok(p.i + 1)) line.push({ ...pt, x: (p.i + 1) * bw });
        }
      }
      // Direct label at the period where this band is thickest, only when it fits.
      let best = -1;
      let bestH = 0;
      pts.forEach((p, i) => {
        const h = Math.abs(y(p.v0) - y(p.v1));
        if (p.defined && h > bestH) { bestH = h; best = i; }
      });
      const label = (s.kind === 'item' || (below && s.kind === 'other')) && bestH >= 18 && best >= 0
        ? { x: (best + 0.5) * bw, y: (y(pts[best].v0) + y(pts[best].v1)) / 2 }
        : null;
      return { s, d: gen(line) ?? '', pts, label, labelH: bestH };
    });
    // Drop direct labels that would collide: keep the thickest bands' labels first.
    const kept: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const order = paths.map((p, i) => ({ i, h: p.labelH }));
    for (const { i } of order.sort((a, b) => b.h - a.h)) {
      const l = paths[i].label;
      if (!l) continue;
      const w = paths[i].s.label.length * 7 + 10;
      const lx = Math.min(Math.max(l.x, 40), innerW - 40);
      const box = { x0: lx - w / 2, x1: lx + w / 2, y0: l.y - 9, y1: l.y + 9 };
      if (kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0)) paths[i].label = null;
      else kept.push(box);
    }
    return { y, paths, below, clippedAt, otherPeak: Math.max(0, ...otherVals) };
  }, [result, metric, shape, otherMode, innerW, innerH, P, bw]);

  const ticks = geo.y.ticks(5);
  const stride = Math.max(1, Math.ceil(64 / bw));
  const labelIdx = result.periods.map((_, i) => i).filter((i) => i % stride === 0);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * innerW;
    const py = ((e.clientY - box.top) / box.height) * innerH;
    const i = Math.min(P - 1, Math.max(0, Math.floor(px / bw)));
    let key: string | null = null;
    for (const l of geo.paths) {
      const p = l.pts[i];
      const top = Math.min(geo.y(p.v0), geo.y(p.v1));
      const bottom = Math.max(geo.y(p.v0), geo.y(p.v1));
      if (p.defined && p.v1 !== p.v0 && py >= top && py <= bottom) key = l.s.key;
    }
    return { i, key };
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = hover?.i ?? -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = Math.max(0, Math.min(P - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      setHover({ i, key: null, x: MARGIN.left + (i + 0.5) * bw, y: MARGIN.top + 8 });
    } else if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) {
      e.preventDefault();
      onSelect('*', cur);
    } else if (e.key === 'Escape') setHover(null);
  };

  const dim = highlight ?? hover?.key ?? null;
  const summary = `${METRIC_LABEL[metric]} by ${result.settings.granularity}, ${result.periods[0]?.label ?? ''} to ${result.periods[P - 1]?.label ?? ''}, stacked by ${result.series.map((s) => s.label).join(', ')}.`;

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Stacked area chart. ${summary} Use left and right arrow keys to read each period; Enter opens details.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        className="chart-svg"
      >
        <defs>
          <pattern id="hatch-u" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="6" fill="rgba(255,255,255,0.45)" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill={theme.surface} />
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${geo.y(t)})`}>
              <line x1={0} x2={innerW} stroke={theme.grid} strokeWidth={1} />
              <text x={-8} dy="0.32em" textAnchor="end" fontSize={11} fill={theme.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtAxis(Math.abs(t), metric)}
              </text>
            </g>
          ))}
          {result.periods.map((p, i) => (p.ms === 0 ? (
            <g key={`e${i}`} data-empty-period={p.label}>
              <rect x={i * bw} y={0} width={bw} height={innerH} fill={theme.emptyBand} />
              <text
                x={(i + 0.5) * bw}
                y={innerH / 2}
                fontSize={11}
                fill={theme.muted}
                textAnchor="middle"
                transform={bw < 70 ? `rotate(-90 ${(i + 0.5) * bw} ${innerH / 2})` : undefined}
              >
                no plays
              </text>
            </g>
          ) : null))}
          <clipPath id={clipId}><rect x={0} y={-2} width={innerW} height={innerH + 2} /></clipPath>
          <g clipPath={`url(#${clipId})`}>
          {geo.paths.map(({ s, d }) => (
            <path
              key={s.key}
              d={d}
              fill={seriesColor(s, theme)}
              stroke={theme.surface}
              strokeWidth={1.5}
              strokeLinejoin="round"
              opacity={dim && dim !== s.key ? 0.22 : 1}
              data-series={s.label}
            >
              <title>{s.label}</title>
            </path>
          ))}
          {geo.paths.map(({ s, d }) => s.kind === 'unclassified' ? (
            <path key={`h${s.key}`} d={d} fill="url(#hatch-u)" pointerEvents="none" opacity={dim && dim !== s.key ? 0.22 : 1} />
          ) : null)}
          </g>
          {geo.paths.map(({ s, label }) => label && (!dim || dim === s.key) ? (
            <text
              key={`l${s.key}`}
              x={Math.min(Math.max(label.x, 40), innerW - 40)}
              y={label.y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill={theme.ink}
              stroke={theme.surface}
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {s.label}
            </text>
          ) : null)}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={theme.axis} />
          {geo.below && geo.clippedAt !== null && (
            <path data-clipped="" pointerEvents="none" fill="none" stroke={theme.surface} strokeWidth={3}
              d={`M0,${innerH - 3}` + Array.from({ length: Math.ceil(innerW / 8) }, (_, k) => ` L${(k + 0.5) * 8},${innerH - (k % 2 ? 3 : 9)}`).join('')} />
          )}
          {geo.below && (
            <g pointerEvents="none" data-zero-line="">
              <line x1={0} x2={innerW} y1={geo.y(0)} y2={geo.y(0)} stroke={theme.ink2} strokeWidth={1.5} />
              <text x={innerW - 4} y={6} dy="0.7em" textAnchor="end" fontSize={11.5} fill={theme.ink2} fontWeight={600} stroke={theme.surface} strokeWidth={3} paintOrder="stroke">Top {result.topIds.length} {({ artist: 'artists', album: 'albums', track: 'songs', genre: 'genres', branch: 'branches' } as Record<string, string>)[result.series[0]?.key.split(':')[0] ?? 'artist'] ?? 'items'} (above)</text>
              <text x={innerW - 4} y={innerH - 6} textAnchor="end" fontSize={11.5} fill={theme.ink2} fontWeight={600} stroke={theme.surface} strokeWidth={3} paintOrder="stroke">{geo.clippedAt !== null ? <>All other {({ artist: 'artists', album: 'albums', track: 'songs', genre: 'genres', branch: 'branches' } as Record<string, string>)[result.series[0]?.key.split(':')[0] ?? 'artist'] ?? 'items'} (below) · clipped, peaks at {fmtAxis(geo.otherPeak, metric)}</> : <>All other {({ artist: 'artists', album: 'albums', track: 'songs', genre: 'genres', branch: 'branches' } as Record<string, string>)[result.series[0]?.key.split(':')[0] ?? 'artist'] ?? 'items'} (below)</>}</text>
            </g>
          )}
          {labelIdx.map((i) => (
            <text key={i} x={(i + 0.5) * bw} y={innerH + 20} textAnchor="middle" fontSize={11} fill={theme.muted}>
              {result.periods[i].label}
            </text>
          ))}
          {hover && (
            <line x1={(hover.i + 0.5) * bw} x2={(hover.i + 0.5) * bw} y1={0} y2={innerH} stroke={theme.ink2} strokeWidth={1} pointerEvents="none" />
          )}
          <rect
            data-testid="stack-hit"
            width={innerW}
            height={innerH}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onPointerMove={(e) => {
              const { i, key } = pick(e);
              setHover({ i, key, x: MARGIN.left + (i + 0.5) * bw, y: e.nativeEvent.offsetY });
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const { i, key } = pick(e as unknown as PointerEvent<SVGRectElement>);
              onSelect(key ?? '*', i);
            }}
          />
        </g>
      </svg>
      {hover && <Tooltip result={result} metric={metric} theme={theme} hover={hover} width={width} />}
    </div>
  );
});

