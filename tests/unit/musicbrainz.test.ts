import { describe, expect, it } from 'vitest';
import { artistQuery, matchArtist, pickGenres, titleCase, type MbArtist } from '../../src/core/musicbrainz';
import { parseGenreCsv } from '../../src/core/genres';

const genres = new Set(['rock', 'alternative rock', 'post-rock', 'electronic', 'indie rock']);

describe('matchArtist', () => {
  const c = (id: string, name: string, score: number, extra: Partial<MbArtist> = {}): MbArtist => ({ id, name, score, ...extra });
  it('accepts exact and folded name matches, picking the highest score', () => {
    expect(matchArtist('Radiohead', [c('1', 'Radiohead', 100), c('2', 'Radiohead Tribute', 70)])).toMatchObject({ match: 'exact', artist: { id: '1' } });
    expect(matchArtist('Sigur Ros', [c('3', 'Sigur Rós', 100)])).toMatchObject({ match: 'folded', artist: { id: '3' } });
    expect(matchArtist('Beatles', [c('4', 'The Beatles', 100)])).toMatchObject({ match: 'folded' });
  });
  it('matches through aliases', () => {
    expect(matchArtist('Ye', [c('5', 'Kanye West', 95, { aliases: [{ name: 'Ye' }] })])).toMatchObject({ match: 'folded', artist: { id: '5' } });
  });
  it('rejects non-matching names instead of taking the top search hit', () => {
    expect(matchArtist('Artist A', [c('6', 'Artist Alpha', 100)])).toMatchObject({ match: 'none', artist: null });
    expect(matchArtist('Anything', [])).toMatchObject({ match: 'none' });
  });
  it('flags several strong same-name artists as ambiguous', () => {
    const r = matchArtist('Nirvana', [c('7', 'Nirvana', 100, { disambiguation: 'US grunge' }), c('8', 'Nirvana', 98, { disambiguation: 'UK 60s' })]);
    expect(r).toMatchObject({ match: 'ambiguous', artist: { id: '7' }, alternatives: 1 });
  });
});

describe('pickGenres', () => {
  it('keeps only official genres, ordered by votes, up to max', () => {
    const tags = [{ name: 'british', count: 9 }, { name: 'alternative rock', count: 7 }, { name: 'rock', count: 12 }, { name: 'seen live', count: 20 }, { name: 'electronic', count: 0 }];
    expect(pickGenres(tags, genres, 1)).toEqual(['Rock']);
    expect(pickGenres(tags, genres, 3)).toEqual(['Rock', 'Alternative Rock']);
    expect(pickGenres(undefined, genres, 1)).toEqual([]);
    expect(titleCase('post-rock')).toBe('Post-Rock');
  });
  it('escapes Lucene phrase queries', () => {
    expect(artistQuery('Say "Hi"')).toBe('artist:"Say \\"Hi\\""');
  });
});

describe('script output is loadable by the app', () => {
  it('reads only the genre column and summarises missing genres', () => {
    const csv = [
      'artist,genre,match,musicbrainz_name,musicbrainz_id,score',
      'Radiohead,Alternative Rock,exact,Radiohead,a74b1b7f,100',
      'Daft Punk,Electronic; House,exact,Daft Punk,056e4f3e,100',
      ...Array.from({ length: 8 }, (_, i) => `Unknown ${i},,none,,,0`),
    ].join('\n');
    const m = parseGenreCsv(csv);
    expect(m.genresByArtist.get('Radiohead')).toEqual(['Alternative Rock']);
    expect(m.genresByArtist.get('Daft Punk')).toEqual(['Electronic', 'House']);
    expect([...m.genresByArtist.values()].flat()).not.toContain('exact');
    expect(m.issues.filter((i) => i.includes('has no genre'))).toHaveLength(5);
    expect(m.issues.some((i) => i.includes('3 more artists with no genre'))).toBe(true);
  });
});

import { cleanAlbumTitle, matchReleaseGroup, mbYear, parseGenreParents, releaseGroupQuery } from '../../src/core/musicbrainz';

describe('enrichment helpers', () => {
  it('parses partial dates and strips edition suffixes', () => {
    expect(mbYear('1994-05-23')).toBe(1994);
    expect(mbYear('1971')).toBe(1971);
    expect(mbYear(undefined)).toBeNull();
    expect(cleanAlbumTitle('Abbey Road (Remastered 2009)')).toBe('Abbey Road');
    expect(cleanAlbumTitle('Rumours (Super Deluxe Edition) [2013 Remaster]')).toBe('Rumours');
    expect(cleanAlbumTitle('Kid A - Deluxe Edition')).toBe('Kid A');
    expect(cleanAlbumTitle('(What’s the Story) Morning Glory?')).toBe('(What’s the Story) Morning Glory?');
    expect(releaseGroupQuery('OK Computer (Remastered)', 'Radiohead', 'a74b')).toBe('releasegroup:"OK Computer" AND arid:a74b');
  });
  it('matches release groups by title + artist and prefers the original year', () => {
    const groups = [
      { id: 'r2', title: 'Abbey Road', score: 100, 'first-release-date': '2019-09-27', 'artist-credit': [{ name: 'The Beatles', artist: { id: 'b1', name: 'The Beatles' } }] },
      { id: 'r1', title: 'Abbey Road', score: 98, 'first-release-date': '1969-09-26', 'primary-type': 'Album', 'artist-credit': [{ name: 'The Beatles', artist: { id: 'b1', name: 'The Beatles' } }] },
      { id: 'x', title: 'Abbey Road', score: 99, 'first-release-date': '1970', 'artist-credit': [{ name: 'George Benson', artist: { id: 'gb', name: 'George Benson' } }] },
    ];
    expect(matchReleaseGroup('Abbey Road (Remastered 2009)', 'The Beatles', 'b1', groups)).toEqual({ match: 'exact', year: 1969, type: 'Album', id: 'r1' });
    expect(matchReleaseGroup('Abbey Road', 'Beatles', null, groups).year).toBe(1969);
    expect(matchReleaseGroup('Let It Be', 'The Beatles', 'b1', groups).match).toBe('none');
  });
  it('parses genre parents from a MusicBrainz genre page', () => {
    const html = '<table class="details"><tbody><tr><th>subgenre of:</th><td style="x"><span class="genrelink"></span><a class="wrap-anywhere" href="/genre/cc28f5aa-5e19-487c-88e1-e56b022f1fdd"><bdi>metal</bdi></a><br/></td></tr><tr><th>fusion of:</th><td><a class="w" href="/genre/11111111-2222-3333-4444-555555555555"><bdi>progressive rock</bdi></a><br/><a class="w" href="/genre/11111111-2222-3333-4444-666666666666"><bdi>black &#x27;n&#x27; roll</bdi></a></td></tr><tr><th>subgenres:</th><td><a class="w" href="/genre/99999999-2222-3333-4444-555555555555"><bdi>nwobhm</bdi></a></td></tr></tbody></table>';
    expect(parseGenreParents(html)).toEqual([
      { id: 'cc28f5aa-5e19-487c-88e1-e56b022f1fdd', name: 'metal', rel: 'subgenre' },
      { id: '11111111-2222-3333-4444-555555555555', name: 'progressive rock', rel: 'fusion' },
      { id: '11111111-2222-3333-4444-666666666666', name: "black 'n' roll", rel: 'fusion' },
    ]);
  });
});
