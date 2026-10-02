import type { AggregateSettings } from '../core/aggregate';
import type { Insights, YearRow } from '../core/insights';
import type { Summary } from '../worker/engine';
import type { WorkerClient } from './workerClient';
import { useWorkerQuery } from './useQuery';
import { fmtHours, fmtInt } from './format';
import { Cover } from './Cover';

const DAY = 86_400_000;
const fmtDayDefault = (day: number) => new Date(day * DAY).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthYear = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Plain-language sentences about the selected range, generated from the numbers. */
/** `routine: false` drops sentences that reveal a daily routine (streak dates, binge days, active days). */
function highlights(sum: Summary, ins: Insights, fmtDay: (day: number) => string = fmtDayDefault, routine = true): string[] {
  const out: string[] = [];
  const ys = ins.years.filter((y) => y.ms > 0);
  if (ys.length > 1) {
    const big = [...ys].sort((a, b) => b.ms - a.ms)[0];
    out.push(`${big.year} was your biggest year: ${fmtHours(big.ms)} of music, ${Math.round(big.ms / 3_600_000 / 365 * 60)} minutes a day on average.`);
    const tops = ys.map((y) => y.topArtist?.name).filter(Boolean) as string[];
    const changes = tops.filter((n, i) => i > 0 && n !== tops[i - 1]).length;
    const distinctTops = [...new Set(tops)];
    out.push(changes === 0
      ? `${tops[0]} was your top artist every year.`
      : `Your top artist changed ${changes} time${changes === 1 ? '' : 's'}: ${distinctTops.slice(0, 5).join(' → ')}${distinctTops.length > 5 ? ' → …' : ''}.`);
    const disc = [...ins.discovery].sort((a, b) => b.discovered - a.discovered)[0];
    if (disc) out.push(`You discovered the most new artists in ${disc.year} (${fmtInt(disc.discovered)}); ${Math.round((disc.stuck / Math.max(1, disc.discovered)) * 100)}% of them you played again 6+ months later.`);
  }
  const o = ins.obsessions;
  if (routine && o.longestStreak && o.longestStreak.days > 2) out.push(`Longest streak: ${o.longestStreak.artist} on ${o.longestStreak.days} days in a row, from ${fmtDay(o.longestStreak.startDay)}.`);
  if (routine && o.biggestTrackDay && o.biggestTrackDay.plays > 3) {
    const b = o.biggestTrackDay;
    const done = b.completed === b.plays ? 'every one to the end' : `${b.completed} of them without skipping`;
    out.push(`Most replayed in one day: “${b.track}” by ${b.artist}, ${b.plays} times on ${fmtDay(b.day)} (${done}).`);
  }
  const ages = ys.map((y) => y.medianMusicAge).filter((a): a is number => a !== null);
  if (ages.length) out.push(`The music you play is typically ${Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)} years old (album release year vs. when you played it).`);
  if (routine && sum.days) out.push(`You listened on ${fmtInt(sum.activeDays)} of ${fmtInt(sum.days)} days (${Math.round((sum.activeDays / sum.days) * 100)}%).`);
  return out;
}

function YearCard({ y, onPick, onOpenArtist }: { y: YearRow; onPick?: () => void; onOpenArtist?: (id: number) => void }) {
  return (
    <li className="year-card" data-testid="year-card">
      <button type="button" className="year-pick" onClick={onPick} title={onPick ? `Show only ${y.year}` : undefined} disabled={!onPick}>
        {y.topAlbum && <Cover src={y.topAlbum.art} name={y.topAlbum.name} size={44} title={`${y.topAlbum.name} · ${y.topAlbum.sub}`} />}
        <span className="year-num">{y.year}</span>
        <span className="year-hours">{fmtHours(y.ms)}</span>
      </button>
      <dl>
        {y.topArtist && <><dt>Artist</dt><dd>{onOpenArtist ? <button type="button" className="link-like" onClick={() => onOpenArtist(y.topArtist!.id)}>{y.topArtist.name}</button> : y.topArtist.name}</dd></>}
        {y.topAlbum && <><dt>Album</dt><dd title={y.topAlbum.sub}>{y.topAlbum.name}</dd></>}
        {y.topTrack && <><dt>Song</dt><dd title={y.topTrack.sub}>{y.topTrack.name}</dd></>}
        {y.topGenre && <><dt>Genre</dt><dd>{y.topGenre}</dd></>}
        <dt>New</dt><dd>{fmtInt(y.newArtists)} artists</dd>
      </dl>
    </li>
  );
}

export function Story({ client, settings, timeZone, version, onPickYear, onOpenEntity, onDataQuality }: {
  client: WorkerClient; settings: AggregateSettings; timeZone: string; version: number;
  onPickYear: (year: number) => void; onOpenEntity: (kind: 'artist' | 'album' | 'track', id: number) => void; onDataQuality: () => void;
}) {
  const { data } = useWorkerQuery<[Summary, Insights]>(client, () => [
    { type: 'summary', settings }, { type: 'insights', settings, timeZone },
  ], [client, settings, timeZone, version]);
  if (!data) return <section className="card story"><p className="muted">Reading your history…</p></section>;
  const [sum, ins] = data;
  return <StoryBody sum={sum} ins={ins} minSeconds={settings.minMs / 1000} onPickYear={onPickYear} onOpenEntity={onOpenEntity} onDataQuality={onDataQuality} />;
}

/** Pure display of the story (also used by the shareable report). */
export function StoryBody({ sum, ins, minSeconds, onPickYear, onOpenEntity, onDataQuality, routine = true, dayFmt = fmtDayDefault }: {
  sum: Summary; ins: Insights; minSeconds: number; routine?: boolean; dayFmt?: (day: number) => string;
  onPickYear?: (year: number) => void; onOpenEntity?: (kind: 'artist' | 'album' | 'track', id: number) => void; onDataQuality?: () => void;
}) {
  const days = sum.ms / DAY;
  return (
    <section className="card story" data-testid="story">
      <div className="hero">
        <div className="hero-main">
          <span className="hero-num" data-testid="hero-hours">{fmtInt(Math.round(sum.ms / 3_600_000))} hours</span>
          <span className="hero-sub">of music · about {fmtInt(Math.round(days))} days non-stop</span>
        </div>
        <div className="hero-facts">
          <span><b data-testid="hero-plays">{fmtInt(sum.plays)}</b> plays</span>
          <span><b>{fmtInt(sum.artists)}</b> artists</span>
          <span><b>{fmtInt(sum.tracks)}</b> songs</span>
          {sum.first !== null && <span>{monthYear(sum.first)} – {monthYear(sum.last!)}</span>}
        </div>
        <p className="muted small hero-note">
          Counting plays of at least {minSeconds} s in the selected dates.{onDataQuality && <> <button type="button" className="link" onClick={onDataQuality}>Data quality</button></>}
        </p>
      </div>
      <ul className="highlights" data-testid="highlights">
        {highlights(sum, ins, dayFmt, routine).map((h) => <li key={h}>{h}</li>)}
      </ul>
      {ins.years.length > 1 && (
        <>
          <h3 className="story-h">Year by year {onPickYear && <span className="muted small">click a year to focus on it</span>}</h3>
          <ol className="years" data-testid="years">
            {ins.years.map((y) => <YearCard key={y.year} y={y} onPick={onPickYear ? () => onPickYear(y.year) : undefined} onOpenArtist={onOpenEntity ? (id) => onOpenEntity('artist', id) : undefined} />)}
          </ol>
        </>
      )}
    </section>
  );
}
