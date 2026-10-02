import { describe, expect, it } from 'vitest';
import { buildGenreTree, partitionBranch, pathTo, ROOT_ID, type TreeData } from '../../src/core/genreTree';

const data: TreeData = {
  genres: {
    'progressive rock': { parents: [{ name: 'rock', rel: 'subgenre' }] },
    'progressive metal': { parents: [{ name: 'metal', rel: 'subgenre' }] },
    'heavy metal': { parents: [{ name: 'metal', rel: 'subgenre' }] },
    'progressive jazz': { parents: [{ name: 'jazz', rel: 'subgenre' }] },
    'post-rock': { parents: [{ name: 'rock', rel: 'subgenre' }] },
    'post-metal': { parents: [{ name: 'metal', rel: 'subgenre' }, { name: 'post-rock', rel: 'fusion' }] },
    'rock and roll': { parents: [{ name: 'rock', rel: 'subgenre' }] },
    rock: { parents: [] },
    metal: { parents: [] },
    jazz: { parents: [] },
  },
};
const mapped = ['Progressive Rock', 'Progressive Metal', 'Heavy Metal', 'Progressive Jazz', 'Post-Rock', 'Post-Metal', 'Rock and Roll', 'Ambient'];

describe('buildGenreTree', () => {
  const t = buildGenreTree(mapped, data);
  const n = (id: string) => t.nodes.get(id)!;

  it('builds MusicBrainz branches with every mapped genre under its ancestors', () => {
    expect([...n('g:metal').leafGenres].sort()).toEqual(['Heavy Metal', 'Post-Metal', 'Progressive Metal']);
    expect([...n('g:rock').leafGenres].sort()).toEqual(['Post-Metal', 'Post-Rock', 'Progressive Rock', 'Rock and Roll']); // post-metal is a fusion with post-rock
    expect(n('g:post-metal').parents.sort()).toEqual(['g:metal', 'g:post-rock', 's:post-']);
    expect(t.mbEdges).toBe(8);
  });

  it('adds name-based style branches only for shared leading words that are not genres themselves', () => {
    expect(n('s:progressive').label).toBe('Progressive (style)');
    expect([...n('s:progressive').leafGenres].sort()).toEqual(['Progressive Jazz', 'Progressive Metal', 'Progressive Rock']);
    expect(n('s:post-').label).toBe('Post- (style)');
    expect(t.nodes.has('s:heavy')).toBe(false); // only one "heavy" genre
    expect(t.nodes.has('s:rock')).toBe(false); // "rock" is a genre, not a style
  });

  it('lists top-level branches under the root, including unconnected genres', () => {
    expect(t.root.children.sort()).toEqual(['g:ambient', 'g:jazz', 'g:metal', 'g:rock', 's:post-', 's:progressive']);
    expect(t.root.leafGenres.size).toBe(mapped.length);
    expect(n('g:ambient').mapped).toBe(true);
    expect(pathTo(t, 'g:progressive metal').map((x) => x.id)).toEqual([ROOT_ID, 'g:metal', 'g:progressive metal']);
  });

  it('works without a MusicBrainz tree (style branches only)', () => {
    const t2 = buildGenreTree(mapped, null);
    expect(t2.mbEdges).toBe(0);
    expect(t2.root.children).toContain('s:progressive');
    expect(t2.root.children).toContain('g:heavy metal');
  });
});

describe('partitionBranch', () => {
  it('assigns each genre to exactly one child, largest child first', () => {
    const t = buildGenreTree(mapped, data);
    const totals: Record<string, number> = { 'g:metal': 50, 'g:rock': 40, 's:progressive': 30, 's:post-': 20, 'g:jazz': 5, 'g:ambient': 1 };
    const part = partitionBranch(t, ROOT_ID, (id) => totals[id] ?? 0);
    expect(part.size).toBe(mapped.length);
    expect(part.get('Post-Metal')).toBe('g:metal'); // in metal, rock and post-: metal is largest
    expect(part.get('Progressive Jazz')).toBe('s:progressive'); // progressive (30) beats jazz (5)
    expect(part.get('Ambient')).toBe('g:ambient');
    const inside = partitionBranch(t, 'g:metal', () => 0);
    expect([...inside.keys()].sort()).toEqual(['Heavy Metal', 'Post-Metal', 'Progressive Metal']);
  });
});
