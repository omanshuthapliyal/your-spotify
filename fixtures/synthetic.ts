/**
 * Deterministic synthetic Spotify Extended Streaming History fixture.
 *
 * Every number here is chosen so tests can assert literal expected values.
 * Music plays are exactly 3 minutes (180 000 ms), so 20 plays = 1 hour.
 *
 * Timeline: 2019 Q1 .. 2022 Q4 (16 quarters, UTC).
 *   - Artist A dominates 2019, fades in 2020 H1, is absent 2020 Q4-2021, returns in 2022.
 *   - Artist B is minor in 2019, grows in 2020 H1, dominates 2020 Q4-2021, minor in 2022.
 *   - 2020 Q3 has no music at all (one podcast episode only) -> an empty period.
 *   - Artists C..J are steady filler so "Other" is non-empty at top N = 5.
 *   - "Sigur Rós" and "Sigur Ros" are a spelling variant pair (2021 Q1).
 *   - "Boundary Artist" plays at 2019-12-31T23:59:59Z and 2020-01-01T00:00:00Z (UTC edges).
 *
 * Edge cases: short plays (5 s, 29 999 ms, 30 000 ms), podcasts, audiobooks, a missing-artist
 * track, an unidentifiable record, invalid dates, malformed entries, a repeated identical
 * record inside one file (a legitimate repeat that must NOT be deduplicated), and one record
 * copied verbatim into a second file (a cross-file overlap that MUST be deduplicated).
 *
 * Sensitive fields carry obviously fake values so tests can assert they never leak.
 */
import { zipSync, strToU8 } from 'fflate';

export const FAKE_SENSITIVE = {
  username: 'fixture-user-SENSITIVE',
  platform: 'FixturePhone OS SENSITIVE',
  conn_country: 'ZZ',
  ip_addr: '203.0.113.77',
  user_agent_decrypted: 'fixture-agent-SENSITIVE',
} as const;

const TRACK_MS = 180_000;
const DAY = 86_400_000;
const MIN = 60_000;

type Rec = Record<string, unknown>;

function quarterStart(qIndex: number): number {
  const year = 2019 + Math.floor(qIndex / 4);
  const month = (qIndex % 4) * 3;
  return Date.UTC(year, month, 1);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function musicRecord(ts: number, artist: string | null, track: string | null, msPlayed: number, uri?: string | null): Rec {
  return {
    ts: iso(ts),
    ...FAKE_SENSITIVE,
    ms_played: msPlayed,
    master_metadata_track_name: track,
    master_metadata_album_artist_name: artist,
    master_metadata_album_album_name: artist ? `${artist} Album` : null,
    spotify_track_uri: uri === undefined ? (track ? `spotify:track:${slug(artist ?? 'x')}${slug(track)}` : null) : uri,
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    audiobook_title: null,
    audiobook_uri: null,
    audiobook_chapter_uri: null,
    audiobook_chapter_title: null,
    reason_start: 'trackdone',
    reason_end: 'trackdone',
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: null,
    incognito_mode: false,
  };
}

function podcastRecord(ts: number, msPlayed: number): Rec {
  return {
    ...musicRecord(ts, null, null, msPlayed, null),
    master_metadata_album_album_name: null,
    episode_name: 'Episode about synthetic data',
    episode_show_name: 'The Fixture Podcast',
    spotify_episode_uri: 'spotify:episode:fixture0001',
  };
}

function audiobookRecord(ts: number, msPlayed: number): Rec {
  return {
    ...musicRecord(ts, null, null, msPlayed, null),
    master_metadata_album_album_name: null,
    audiobook_title: 'A Fixture Audiobook',
    audiobook_uri: 'spotify:show:fixturebook',
    audiobook_chapter_uri: 'spotify:episode:fixturechapter',
    audiobook_chapter_title: 'Chapter 1',
  };
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').padEnd(4, 'x');
}

/** Plays per quarter (index 0 = 2019 Q1). 20 plays = 1 hour. */
function artistPlan(q: number): Array<[string, number]> {
  if (q === 6) return []; // 2020 Q3: empty period
  const year = 2019 + Math.floor(q / 4);
  const inYear = q % 4;
  let a = 0;
  let b = 0;
  if (year === 2019) { a = 80; b = 10; }
  else if (year === 2020 && inYear < 2) { a = 20; b = 60; }
  else if (year === 2020 || year === 2021) { a = 0; b = 100; }
  else { a = 60; b = 20; }
  const plan: Array<[string, number]> = [
    ['Artist A', a],
    ['Artist B', b],
    ['Artist C', 16],
    ['Artist D', 14],
    ['Artist E', 12],
    ['Artist F', 10],
    ['Artist G', 8],
    ['Artist H', 6],
    ['Artist I', 4],
    ['Artist J', 2],
  ];
  if (q === 8) plan.push(['Sigur Rós', 4], ['Sigur Ros', 2]);
  return plan.filter(([, n]) => n > 0);
}

export interface FixtureFile {
  name: string;
  content: string;
}

export function buildExtendedFixture(): { audio0: Rec[]; audio1: Rec[]; video: unknown[] } {
  const audio0: Rec[] = []; // 2019-2020
  const audio1: unknown[] = []; // 2021-2022 (+ malformed entries)
  for (let q = 0; q < 16; q++) {
    const target = q < 8 ? audio0 : audio1;
    // Spread each artist's plays evenly across ~80 days of the quarter, interleaved by time.
    const slots: Array<{ ts: number; artist: string; i: number }> = [];
    artistPlan(q).forEach(([artist, n], artistIdx) => {
      for (let i = 0; i < n; i++) {
        const frac = (i + 0.5) / n;
        slots.push({ ts: quarterStart(q) + DAY + Math.round(frac * 80 * DAY / MIN) * MIN + artistIdx * MIN, artist, i });
      }
    });
    slots.sort((a, b) => a.ts - b.ts);
    const firstA = slots.find((s) => s.artist === 'Artist A' && s.i === 0);
    for (const { ts, artist, i } of slots) {
      // Three tracks per artist, repeated: legitimate repeated listens.
      // Artist A 2019 Q1: play 1 is a byte-identical copy of play 0 (same ts and track).
      const dup = q === 0 && artist === 'Artist A' && i === 1;
      target.push(musicRecord(dup ? firstA!.ts : ts, artist, dup ? `${artist} Song 1` : `${artist} Song ${(i % 3) + 1}`, TRACK_MS));
    }
  }

  // UTC boundary plays (would land in different quarters under a US or Asian local timezone).
  audio0.push(musicRecord(Date.UTC(2019, 11, 31, 23, 59, 59), 'Boundary Artist', 'Midnight', TRACK_MS));
  audio0.push(musicRecord(Date.UTC(2020, 0, 1, 0, 0, 0), 'Boundary Artist', 'Midnight', TRACK_MS));

  // Short plays in 2019 Q2 (all Artist C at 5 s) plus threshold edges for Artist D.
  const q2 = quarterStart(1) + 40 * DAY;
  // ...skipped with the forward button, as Spotify records quick skips.
  for (let i = 0; i < 30; i++) audio0.push({ ...musicRecord(q2 + i * MIN, 'Artist C', 'Artist C Song 1', 5_000), skipped: true, reason_end: 'fwdbtn' });
  audio0.push(musicRecord(q2 + 31 * MIN, 'Artist D', 'Artist D Song 1', 29_999)); // excluded at 30 s
  audio0.push(musicRecord(q2 + 32 * MIN, 'Artist D', 'Artist D Song 1', 30_000)); // included at 30 s

  // Podcasts: ten 30-minute episodes in 2019 Q3, one in the empty 2020 Q3.
  const q3 = quarterStart(2) + 10 * DAY;
  for (let i = 0; i < 10; i++) audio0.push(podcastRecord(q3 + i * 45 * MIN, 1_800_000));
  audio0.push(podcastRecord(quarterStart(6) + 20 * DAY, 1_800_000));

  // Audiobook chapters in 2022 Q2.
  audio1.push(audiobookRecord(quarterStart(13) + 5 * DAY, 600_000));
  audio1.push(audiobookRecord(quarterStart(13) + 6 * DAY, 600_000));

  // Missing artist (track present) and an unidentifiable record (all metadata null).
  audio1.push(musicRecord(quarterStart(9) + 3 * DAY, null, 'Orphan Track', TRACK_MS));
  audio1.push(musicRecord(quarterStart(9) + 4 * DAY, null, null, 1_000, null));

  // Invalid dates.
  audio1.push({ ...musicRecord(quarterStart(9), 'Artist A', 'Artist A Song 1', TRACK_MS), ts: 'not-a-date' });
  audio1.push({ ...musicRecord(quarterStart(9), 'Artist A', 'Artist A Song 1', TRACK_MS), ts: '1970-01-01T00:00:00Z' });

  // Malformed entries.
  audio1.push(null);
  audio1.push(42);
  audio1.push({ ...musicRecord(quarterStart(9), 'Artist A', 'Artist A Song 1', TRACK_MS), ms_played: 'abc' });
  const noTs: Rec = { ...musicRecord(quarterStart(9), 'Artist A', 'Artist A Song 1', TRACK_MS) };
  delete noTs.ts;
  audio1.push(noTs);

  // Video history file: one record copied verbatim from audio0 (cross-file overlap).
  const video: unknown[] = [structuredClone(audio0[5])];

  return { audio0, audio1: audio1 as Rec[], video };
}

/** Literal expectations for the default settings (quarter, 30 s threshold), documented for tests. */
export const EXPECTED = {
  acceptedPlays: 2429,
  acceptedMs: 2428 * TRACK_MS + 30_000, // 437 070 000 ms = 121.408333... h
  belowThreshold30s: { count: 31, ms: 30 * 5_000 + 29_999 },
  podcast: { count: 11, ms: 11 * 1_800_000 },
  audiobook: { count: 2, ms: 1_200_000 },
  missingArtist: 1,
  unidentified: 1,
  invalidDate: 2,
  malformed: 4,
  crossFileDuplicate: 1,
  firstPlayIso: '2019-01-02T12:00:00.000Z',
  quarters: 16,
  emptyQuarterLabel: '2020 Q3',
} as const;

export function extendedFixtureFiles(): FixtureFile[] {
  const { audio0, audio1, video } = buildExtendedFixture();
  return [
    { name: 'Streaming_History_Audio_2019-2020_0.json', content: JSON.stringify(audio0, null, 1) },
    { name: 'Streaming_History_Audio_2021-2022_1.json', content: JSON.stringify(audio1, null, 1) },
    { name: 'Streaming_History_Video_2019-2022.json', content: JSON.stringify(video, null, 1) },
  ];
}

export function extendedFixtureZip(): Uint8Array {
  const dir = 'Spotify Extended Streaming History/';
  const entries: Record<string, Uint8Array> = {};
  for (const f of extendedFixtureFiles()) entries[dir + f.name] = strToU8(f.content);
  entries[dir + 'ReadMeFirst_ExtendedStreamingHistory.pdf'] = strToU8('%PDF-1.4 synthetic placeholder');
  entries['__MACOSX/._junk'] = strToU8('mac resource fork');
  return zipSync(entries, { level: 6, mtime: new Date(Date.UTC(2024, 0, 1)) });
}

export function oneYearFixture(): FixtureFile {
  return {
    name: 'StreamingHistory_music_0.json',
    content: JSON.stringify([
      { endTime: '2023-01-05 10:12', artistName: 'Artist A', trackName: 'Artist A Song 1', msPlayed: 180000 },
      { endTime: '2023-01-05 10:15', artistName: 'Artist B', trackName: 'Artist B Song 1', msPlayed: 180000 },
    ]),
  };
}

/** Large deterministic fixture for performance smoke tests. */
export function largeFixture(records: number): string {
  const out: string[] = [];
  const start = Date.UTC(2012, 0, 1);
  const span = Date.UTC(2025, 0, 1) - start;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < records; i++) {
    const ts = start + Math.floor((i / records) * span);
    const artistIdx = Math.floor(Math.pow(rand(), 2.5) * 3000);
    const artist = `Perf Artist ${artistIdx}`;
    const ms = Math.floor(rand() * 300_000);
    out.push(JSON.stringify(musicRecord(ts, artist, `Track ${artistIdx}-${Math.floor(rand() * 20)}`, ms)));
  }
  return '[' + out.join(',\n') + ']';
}
