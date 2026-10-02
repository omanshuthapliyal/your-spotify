import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { importFiles, nameVariantKey } from '../../src/core/importer';
import { EXPECTED, FAKE_SENSITIVE, oneYearFixture } from '../../fixtures/synthetic';
import { fixtureInputs, fixtureZipInput, importFixture, NOW } from './helpers';

// Import totals are threshold-independent: every valid music play is kept; the duration
// threshold is applied at aggregation time so it can be changed without re-importing.
const ALL_MUSIC_PLAYS = EXPECTED.acceptedPlays + EXPECTED.belowThreshold30s.count;
const ALL_MUSIC_MS = EXPECTED.acceptedMs + EXPECTED.belowThreshold30s.ms;

describe('importFiles on the synthetic fixture', () => {
  it('reconciles accepted and excluded counts with the fixture plan', async () => {
    const { audit, store } = await importFixture();
    expect(audit.error).toBeNull();
    expect(audit.acceptedMusic).toEqual({ count: ALL_MUSIC_PLAYS, ms: ALL_MUSIC_MS });
    expect(store.length).toBe(ALL_MUSIC_PLAYS);
    expect(audit.excluded.podcast).toEqual(EXPECTED.podcast);
    expect(audit.excluded.audiobook).toEqual(EXPECTED.audiobook);
    expect(audit.excluded.missingArtist.count).toBe(EXPECTED.missingArtist);
    expect(audit.excluded.unidentified.count).toBe(EXPECTED.unidentified);
    expect(audit.excluded.invalidDate.count).toBe(EXPECTED.invalidDate);
    expect(audit.excluded.malformed.count).toBe(EXPECTED.malformed);
    expect(audit.excluded.crossFileDuplicate.count).toBe(EXPECTED.crossFileDuplicate);
    const excludedTotal = Object.values(audit.excluded).reduce((s, c) => s + c.count, 0);
    expect(audit.acceptedMusic.count + excludedTotal).toBe(audit.recordsRead);
    expect(new Date(audit.firstPlay!).toISOString()).toBe(EXPECTED.firstPlayIso);
  });

  it('keeps repeated identical records within one file (legitimate repeats)', async () => {
    const { store } = await importFixture();
    // Plays 0 and 1 of Artist A in 2019 Q1 are byte-identical; both must be present.
    const t0 = store.endedAt[0];
    let same = 0;
    for (let i = 0; i < store.length; i++) if (store.endedAt[i] === t0 && store.artistNames[store.artist[i]] === 'Artist A') same++;
    expect(same).toBe(2);
  });

  it('gives the same result for the ZIP and for the loose JSON files', async () => {
    const a = await importFiles([fixtureZipInput()], { nowMs: NOW });
    const b = await importFixture();
    expect(a.audit.acceptedMusic).toEqual(b.audit.acceptedMusic);
    expect(a.audit.excluded).toEqual(b.audit.excluded);
    expect(a.audit.files.filter((f) => f.status === 'ignored').map((f) => f.name)).toEqual([
      'my_spotify_data.zip › Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf',
    ]);
  });

  it('does not double-count a file imported twice (ZIP plus loose copy)', async () => {
    const loose = fixtureInputs()[0];
    const { audit } = await importFiles([fixtureZipInput(), loose, { ...loose, name: 'renamed-copy.json' }], { nowMs: NOW });
    expect(audit.acceptedMusic.count).toBe(ALL_MUSIC_PLAYS);
    expect(audit.files.filter((f) => f.status === 'duplicate')).toHaveLength(2);
  });

  it('never retains sensitive fields', async () => {
    const { audit, store } = await importFixture();
    const dump = JSON.stringify({ audit, names: store.artistNames, tracks: store.trackNames });
    for (const v of Object.values(FAKE_SENSITIVE)) expect(dump).not.toContain(v);
    expect(Object.keys(store).sort()).toEqual(['album', 'albumArtist', 'albumNames', 'artist', 'artistNames', 'endedAt', 'length', 'msPlayed', 'shuffle', 'skip', 'track', 'trackArtist', 'trackNames']);
    // albums are keyed by (album artist, album name)
    expect(store.albumNames.filter((a) => a === 'Artist A Album')).toHaveLength(1);
  });

  it('reports spelling variants without merging them', async () => {
    const { audit, store } = await importFixture();
    expect(audit.nameVariants).toEqual([['Sigur Ros', 'Sigur Rós']]);
    expect(store.artistNames).toContain('Sigur Ros');
    expect(store.artistNames).toContain('Sigur Rós');
    expect(nameVariantKey('The Beatles')).toBe(nameVariantKey('beatles'));
  });
});

describe('importFiles error handling', () => {
  it('rejects empty imports', async () => {
    expect((await importFiles([], { nowMs: NOW })).audit.error).toMatch(/No files/);
  });
  it('identifies one-year Streaming History', async () => {
    const f = oneYearFixture();
    const { audit } = await importFiles([{ name: f.name, bytes: strToU8(f.content) }], { nowMs: NOW });
    expect(audit.files[0].status).toBe('one-year');
    expect(audit.error).toMatch(/one-year/);
  });
  it('reports unsupported, empty, invalid JSON and invalid ZIP files', async () => {
    const { audit } = await importFiles([
      { name: 'a.json', bytes: strToU8('{"x":1}') },
      { name: 'b.json', bytes: strToU8('[]') },
      { name: 'c.json', bytes: strToU8('[{bad') },
      { name: 'd.zip', bytes: strToU8('not a zip') },
      { name: 'e.csv', bytes: strToU8('a,b') },
    ], { nowMs: NOW });
    expect(audit.files.map((f) => f.status)).toEqual(['invalid-zip', 'unsupported', 'unsupported', 'empty', 'invalid-json']);
    expect(audit.error).toMatch(/No Spotify Extended Streaming History/);
  });
});
