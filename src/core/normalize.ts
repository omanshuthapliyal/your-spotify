/**
 * Record-level validation and classification for Spotify Extended Streaming History.
 *
 * Only the fields needed for computation are read. Sensitive fields (ip_addr, conn_country,
 * platform, username, user_agent_decrypted, ...) are never copied into the output.
 */

export type ExclusionReason =
  | 'podcast'
  | 'audiobook'
  | 'missingArtist'
  | 'unidentified'
  | 'invalidDate'
  | 'malformed';

export interface MusicPlay {
  kind: 'music';
  endedAt: number; // epoch ms, UTC
  msPlayed: number;
  artistName: string;
  trackName: string;
  trackUri: string | null;
  /** master_metadata_album_album_name; null when absent. */
  albumName: string | null;
  /** Playback behaviour (not identifying): null when the export does not say. */
  skipped: boolean | null;
  shuffle: boolean | null;
  reasonEnd: string | null;
}

export interface ExcludedRecord {
  kind: 'excluded';
  reason: ExclusionReason;
  /** ms_played when it was a valid number, else 0. Used to report excluded listening time. */
  msPlayed: number;
}

export type NormalizedRecord = MusicPlay | ExcludedRecord;

/** Spotify launched in October 2008; earlier timestamps (e.g. 1970-01-01) are export artefacts. */
export const EARLIEST_VALID_TS = Date.UTC(2008, 0, 1);

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function normalizeRecord(raw: unknown, nowMs: number): NormalizedRecord {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'excluded', reason: 'malformed', msPlayed: 0 };
  }
  const r = raw as Record<string, unknown>;
  const ms = r.ms_played;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return { kind: 'excluded', reason: 'malformed', msPlayed: 0 };
  }
  if (r.ts === undefined || r.ts === null) {
    return { kind: 'excluded', reason: 'malformed', msPlayed: ms };
  }
  const ts = typeof r.ts === 'string' && ISO_UTC.test(r.ts) ? Date.parse(r.ts) : NaN;
  if (!Number.isFinite(ts) || ts < EARLIEST_VALID_TS || ts > nowMs + 86_400_000) {
    return { kind: 'excluded', reason: 'invalidDate', msPlayed: ms };
  }

  if (nonEmpty(r.spotify_episode_uri) || nonEmpty(r.episode_name) || nonEmpty(r.episode_show_name)) {
    return { kind: 'excluded', reason: 'podcast', msPlayed: ms };
  }
  if (nonEmpty(r.audiobook_uri) || nonEmpty(r.audiobook_title) || nonEmpty(r.audiobook_chapter_uri)) {
    return { kind: 'excluded', reason: 'audiobook', msPlayed: ms };
  }

  const track = r.master_metadata_track_name;
  const uri = nonEmpty(r.spotify_track_uri) ? r.spotify_track_uri : null;
  if (!nonEmpty(track) && uri === null) {
    return { kind: 'excluded', reason: 'unidentified', msPlayed: ms };
  }
  const artist = r.master_metadata_album_artist_name;
  if (!nonEmpty(artist)) {
    return { kind: 'excluded', reason: 'missingArtist', msPlayed: ms };
  }
  return {
    kind: 'music',
    endedAt: ts,
    msPlayed: ms,
    artistName: artist,
    trackName: nonEmpty(track) ? track : '(untitled track)',
    trackUri: uri,
    albumName: nonEmpty(r.master_metadata_album_album_name) ? r.master_metadata_album_album_name : null,
    skipped: typeof r.skipped === 'boolean' ? r.skipped : null,
    shuffle: typeof r.shuffle === 'boolean' ? r.shuffle : null,
    reasonEnd: nonEmpty(r.reason_end) ? r.reason_end : null,
  };
}

export type FileKind = 'extended' | 'one-year' | 'unsupported' | 'empty';

/** Identify a parsed JSON document by schema, not by file name. */
export function sniffFileKind(doc: unknown): FileKind {
  if (!Array.isArray(doc)) return 'unsupported';
  if (doc.length === 0) return 'empty';
  let extended = 0;
  let oneYear = 0;
  const sample = Math.min(doc.length, 50);
  for (let i = 0; i < sample; i++) {
    const r = doc[i];
    if (r === null || typeof r !== 'object') continue;
    if ('ms_played' in r && ('ts' in r || 'master_metadata_track_name' in r || 'spotify_track_uri' in r)) extended++;
    else if ('msPlayed' in r && ('endTime' in r || 'artistName' in r || 'podcastName' in r)) oneYear++;
  }
  if (extended > 0 && extended >= oneYear) return 'extended';
  if (oneYear > 0) return 'one-year';
  return 'unsupported';
}
