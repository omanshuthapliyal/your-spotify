/**
 * Genre tree (really a DAG: a genre can have several parents).
 *
 * Two sources, always labelled in the UI:
 *  - MusicBrainz relationships ("subgenre of" / "fusion of"), fetched by `npm run enrich`.
 *  - Style branches derived from genre NAMES: when two or more of your mapped genres share a
 *    leading word ("Progressive Rock", "Progressive Metal") or prefix ("Post-Rock", "Post-Metal"),
 *    they are grouped under "Progressive (style)" / "Post- (style)". A word that is itself a
 *    genre on MusicBrainz (rock, jazz, metal...) does not become a style branch.
 *
 * Counting rules:
 *  - A branch total counts each play once, even if several of the artist's genres are inside it.
 *  - For stacked "children of a branch" views every genre is assigned to exactly one child (the
 *    child with the most listening), so the parts add up to the branch total.
 */
import { titleCase } from './musicbrainz';

export interface TreeData {
  genres: Record<string, { parents: Array<{ name: string; rel: string }> }>;
}

export interface GenreNode {
  id: string;
  label: string;
  kind: 'genre' | 'style' | 'root';
  parents: string[];
  children: string[];
  /** Mapped genre labels (as used by artists) inside this branch, including the node itself. */
  leafGenres: Set<string>;
  /** True when artists are mapped to exactly this genre. */
  mapped: boolean;
}

export interface GenreTree {
  nodes: Map<string, GenreNode>;
  /** Synthetic root whose children are the top-level branches. */
  root: GenreNode;
  /** How many relationships came from MusicBrainz (0 = no tree file). */
  mbEdges: number;
}

export const ROOT_ID = 'root';
const lc = (s: string) => s.toLowerCase();

function styleWord(genre: string): string | null {
  const g = lc(genre);
  const hy = /^([a-z]+)-(?=[a-z])/.exec(g);
  if (hy) return `${hy[1]}-`;
  const sp = /^([a-z]+)\s+\S/.exec(g);
  return sp ? sp[1] : null;
}

export function buildGenreTree(mappedGenres: string[], data: TreeData | null): GenreTree {
  const nodes = new Map<string, GenreNode>();
  const mapped = new Map(mappedGenres.map((g) => [lc(g), g]));
  const mb = data?.genres ?? {};
  const node = (id: string, label: string, kind: GenreNode['kind']) => {
    let n = nodes.get(id);
    if (!n) { n = { id, label, kind, parents: [], children: [], leafGenres: new Set(), mapped: false }; nodes.set(id, n); }
    return n;
  };
  const link = (child: GenreNode, parent: GenreNode) => {
    if (child.id === parent.id || child.parents.includes(parent.id)) return;
    child.parents.push(parent.id);
    parent.children.push(child.id);
  };
  let mbEdges = 0;

  // MusicBrainz graph, walked upward from every mapped genre.
  const visit = (name: string, seen: Set<string>) => {
    if (seen.has(name)) return;
    seen.add(name);
    const n = node(`g:${name}`, mapped.get(name) ?? titleCase(name), 'genre');
    for (const p of mb[name]?.parents ?? []) {
      const pn = node(`g:${p.name}`, mapped.get(p.name) ?? titleCase(p.name), 'genre');
      if (!n.parents.includes(pn.id)) mbEdges++;
      link(n, pn);
      visit(p.name, seen);
    }
  };
  for (const name of mapped.keys()) visit(name, new Set());
  for (const [name, label] of mapped) {
    const n = nodes.get(`g:${name}`)!;
    n.mapped = true;
    n.label = label;
  }

  // Style branches from shared leading words.
  const isGenreName = (w: string) => mb[w.replace(/-$/, '')] !== undefined || mapped.has(w.replace(/-$/, ''));
  const byWord = new Map<string, string[]>();
  for (const name of mapped.keys()) {
    const w = styleWord(name);
    if (w && !isGenreName(w)) byWord.set(w, [...(byWord.get(w) ?? []), name]);
  }
  for (const [w, members] of byWord) {
    if (members.length < 2) continue;
    const label = w.endsWith('-') ? `${titleCase(w.slice(0, -1))}- (style)` : `${titleCase(w)} (style)`;
    const s = node(`s:${w}`, label, 'style');
    for (const m of members) link(nodes.get(`g:${m}`)!, s);
  }

  // Leaf genres per node: every mapped genre propagates to all its ancestors.
  for (const [name, label] of mapped) {
    const stack = [`g:${name}`];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = nodes.get(id)!;
      n.leafGenres.add(label);
      stack.push(...n.parents);
    }
  }
  // Prune branches that contain none of your genres (cannot happen with upward walks, but keep it safe).
  for (const [id, n] of nodes) if (!n.leafGenres.size) nodes.delete(id);

  const root: GenreNode = { id: ROOT_ID, label: 'All genres', kind: 'root', parents: [], children: [], leafGenres: new Set(mapped.values()), mapped: false };
  for (const n of nodes.values()) if (!n.parents.length) root.children.push(n.id);
  nodes.set(ROOT_ID, root);
  for (const n of nodes.values()) n.children.sort();
  return { nodes, root, mbEdges };
}

/**
 * Assign every genre in `node` to exactly one part: one of the node's children or the node
 * itself. Ties go to the child with the larger total, so parts add up to the branch total.
 */
export function partitionBranch(tree: GenreTree, nodeId: string, totalOf: (childId: string) => number): Map<string, string> {
  const n = tree.nodes.get(nodeId);
  const out = new Map<string, string>();
  if (!n) return out;
  const kids = n.children.map((c) => tree.nodes.get(c)!).sort((a, b) => totalOf(b.id) - totalOf(a.id) || a.id.localeCompare(b.id));
  for (const g of n.leafGenres) {
    const child = kids.find((k) => k.leafGenres.has(g));
    out.set(g, child ? child.id : n.id);
  }
  return out;
}

/** Path(s) from the root to a node, for breadcrumbs (first path by label order). */
export function pathTo(tree: GenreTree, id: string): GenreNode[] {
  const out: GenreNode[] = [];
  let cur = tree.nodes.get(id);
  const seen = new Set<string>();
  while (cur && cur.id !== ROOT_ID && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    const p = [...cur.parents].sort()[0];
    cur = p ? tree.nodes.get(p) : undefined;
  }
  return [tree.root, ...out];
}
