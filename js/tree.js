/* Pure functions over roadmap data. No DOM and no storage in here, so it is easy to test and reuse.

   Roadmap JSON shape (every roadmap file, including projects and interview):
   {
     "id": "devops", "title": "DevOps and SRE",
     "children": [ node, node, ... ]            // top level = phases
   }

   Node:
   {
     "id": "linux-fs-find-basic",               // required, unique across ALL roadmap files
     "title": "Basic find usage",               // required
     "level": "beginner",                       // optional, inherited from the nearest ancestor that sets it
     "priority": "high",                        // optional, inherited the same way
     "hours": 1.5,                              // leaves only; parents are the sum of their leaves
     "prereqs": ["linux-fs-hierarchy"],         // optional ids; shown as a hint, never blocks you
     "tags": ["cli"],                           // optional, searchable
     "problems": 12,                            // DSA leaves only: number of practice problems
     "description": "", "children": []
   }

   Depth (phase, domain, topic, subtopic, deep) comes from nesting.
   Status lives on LEAVES only. A node with no children is a leaf. */

export const STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
});
export const STATUS_LIST = Object.freeze([STATUS.NOT_STARTED, STATUS.IN_PROGRESS, STATUS.COMPLETED]);
export const STATUS_LABEL = Object.freeze({
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
});
export const LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced', 'expert']);
export const DEFAULT_HOURS = 0.5; // used when a leaf has no "hours", so it still counts in weighted progress

export const isValidStatus = (s) => STATUS_LIST.includes(s);

/* ---------- Indexing ---------- */

/**
 * Walks a roadmap once and builds lookup structures.
 * Returns { rootKey, title, roots, byId, leaves, warnings }.
 * Each byId entry: { id, node, parentId, depth, rootKey, titlePath, idPath,
 *                    childIds, leafIds, isLeaf, level, priority, hours, hay }
 */
export function buildIndex(roadmap, rootKey) {
  const byId = new Map();
  const leaves = [];
  const roots = [];
  const warnings = [];

  const visit = (node, parentId, depth, titlePath, idPath, inherited) => {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || typeof node.title !== 'string') {
      warnings.push(`[${rootKey}] Skipped a node without a string "id" and "title" under "${parentId ?? 'root'}".`);
      return;
    }
    if (byId.has(node.id)) {
      warnings.push(`[${rootKey}] Duplicate id "${node.id}" skipped. Ids must be unique.`);
      return;
    }

    const level = node.level ?? inherited.level ?? null;
    const priority = node.priority ?? inherited.priority ?? null;
    if (level && !LEVELS.includes(level)) warnings.push(`[${rootKey}] "${node.id}" has unknown level "${level}".`);

    const tags = Array.isArray(node.tags) ? node.tags : [];
    const entry = {
      id: node.id,
      node,
      parentId,
      depth,
      rootKey,
      titlePath: [...titlePath, node.title],
      idPath: [...idPath, node.id],
      childIds: [],
      leafIds: [],
      isLeaf: false,
      level,
      priority,
      hours: Number.isFinite(node.hours) && node.hours >= 0 ? node.hours : DEFAULT_HOURS,
      hay: '',
    };
    entry.hay = [...entry.titlePath, ...tags].join(' > ').toLowerCase();
    byId.set(node.id, entry);

    const kids = Array.isArray(node.children) ? node.children : [];
    for (const child of kids) {
      const before = byId.size;
      visit(child, node.id, depth + 1, entry.titlePath, entry.idPath, { level, priority });
      if (byId.size > before) entry.childIds.push(child.id);
    }

    entry.isLeaf = entry.childIds.length === 0;
    if (entry.isLeaf) {
      leaves.push(node.id);
      // register this leaf with every ancestor so bulk actions are O(1) lookups
      for (const aid of entry.idPath) if (aid !== node.id) byId.get(aid).leafIds.push(node.id);
    }
  };

  const top = Array.isArray(roadmap?.children) ? roadmap.children : [];
  for (const phase of top) {
    const before = byId.size;
    visit(phase, null, 0, [], [], { level: null, priority: null });
    if (byId.size > before) roots.push(phase.id);
  }

  return { rootKey, title: roadmap?.title ?? rootKey, roots, byId, leaves, warnings };
}

/** Checks that every prereq id points at something that exists in any loaded roadmap. */
export function findDanglingPrereqs(indexes) {
  const known = new Set();
  for (const idx of indexes) for (const id of idx.byId.keys()) known.add(id);
  const warnings = [];
  for (const idx of indexes) {
    for (const e of idx.byId.values()) {
      for (const p of e.node.prereqs ?? []) {
        if (!known.has(p)) warnings.push(`[${idx.rootKey}] "${e.id}" lists unknown prerequisite "${p}".`);
      }
    }
  }
  return warnings;
}

/** Total practice problems for a DSA node: a number, or an object like { easy: 5, medium: 8, hard: 2 }. */
export function problemTotal(node) {
  const p = node?.problems;
  if (Number.isFinite(p)) return Math.max(0, p);
  if (p && typeof p === 'object') return Object.values(p).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  return 0;
}

/* ---------- Rollups (progress math) ---------- */

export const blankRollup = () => ({
  total: 0, completed: 0, inProgress: 0, notStarted: 0,
  hoursTotal: 0, hoursCompleted: 0, hoursInProgress: 0,
});

export function addRollup(target, src) {
  for (const k of Object.keys(target)) target[k] += src[k];
  return target;
}

/** Completion percent 0-100. Whole number; never shows 100 unless everything is completed. */
export function percent(r, weighted = true) {
  const done = weighted ? r.hoursCompleted : r.completed;
  const all = weighted ? r.hoursTotal : r.total;
  if (all <= 0) return 0;
  if (r.completed === r.total) return 100;
  return Math.min(99, Math.floor((done / all) * 100));
}

/** Parent rows do not store a status; this derives what to show for them. */
export function derivedStatus(r) {
  if (r.total > 0 && r.completed === r.total) return STATUS.COMPLETED;
  if (r.inProgress > 0 || r.completed > 0) return STATUS.IN_PROGRESS;
  return STATUS.NOT_STARTED;
}

/**
 * Cached rollups for one roadmap. rebuild() is a full pass; update(leafIds) recomputes
 * only the changed leaves and their ancestor chains, so a click stays instant at thousands of nodes.
 */
export class Rollups {
  constructor(index, getStatus) {
    this.index = index;
    this.getStatus = getStatus;
    this.map = new Map();
    this.root = blankRollup();
    this.rebuild();
  }

  rebuild() {
    this.map.clear();
    for (const id of this.index.roots) this.#compute(id);
    this.#computeRoot();
  }

  update(leafIds) {
    const touched = new Set();
    for (const id of leafIds) {
      const e = this.index.byId.get(id);
      if (e) for (const aid of e.idPath) touched.add(aid);
    }
    // deepest first, so children are fresh before their parents are summed
    const ordered = [...touched].map((id) => this.index.byId.get(id)).sort((a, b) => b.depth - a.depth);
    for (const e of ordered) this.map.set(e.id, this.#fromEntry(e));
    this.#computeRoot();
  }

  get(id) {
    return this.map.get(id) ?? blankRollup();
  }

  #compute(id) {
    const e = this.index.byId.get(id);
    if (!e.isLeaf) for (const cid of e.childIds) this.#compute(cid);
    const r = this.#fromEntry(e);
    this.map.set(id, r);
    return r;
  }

  #fromEntry(e) {
    const r = blankRollup();
    if (e.isLeaf) {
      r.total = 1;
      r.hoursTotal = e.hours;
      const s = this.getStatus(e.id);
      if (s === STATUS.COMPLETED) { r.completed = 1; r.hoursCompleted = e.hours; }
      else if (s === STATUS.IN_PROGRESS) { r.inProgress = 1; r.hoursInProgress = e.hours; }
      else r.notStarted = 1;
      return r;
    }
    for (const cid of e.childIds) addRollup(r, this.map.get(cid) ?? blankRollup());
    return r;
  }

  #computeRoot() {
    const root = blankRollup();
    for (const id of this.index.roots) addRollup(root, this.map.get(id) ?? blankRollup());
    this.root = root;
  }
}

/* ---------- Search and filter ---------- */

export const tokenize = (q) => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Filters by status, level and search text.
 * A leaf matches when ALL search words appear somewhere in its full path (phase > domain > topic > ... > leaf)
 * or its tags, so searching "linux find" finds the find leaves under Linux, and results keep their context.
 *
 * Returns { active, visible: Set|null, matches: Set, expand: Set, count, total }.
 *   visible: ids to render (leaves that match plus all their ancestors); null when no filter is active
 *   matches: ids whose OWN title contains a search word (for highlighting)
 *   expand:  ancestor ids that should be opened so results are visible
 */
export function filterTree(index, { query = '', status = 'all', levels = null } = {}, getStatus) {
  const tokens = tokenize(query);
  const hasLevels = levels && levels.size > 0;
  const total = index.leaves.length;

  if (!tokens.length && status === 'all' && !hasLevels) {
    return { active: false, visible: null, matches: new Set(), expand: new Set(), count: total, total };
  }

  const visible = new Set();
  const expand = new Set();
  let count = 0;

  for (const id of index.leaves) {
    const e = index.byId.get(id);
    if (status !== 'all' && getStatus(id) !== status) continue;
    if (hasLevels && !levels.has(e.level)) continue;
    if (tokens.length && !tokens.every((t) => e.hay.includes(t))) continue;
    count++;
    for (const aid of e.idPath) {
      visible.add(aid);
      if (aid !== id) expand.add(aid);
    }
  }

  const matches = new Set();
  if (tokens.length) {
    for (const id of visible) {
      const title = index.byId.get(id).node.title.toLowerCase();
      if (tokens.some((t) => title.includes(t))) matches.add(id);
    }
  }

  return { active: true, visible, matches, expand, count, total };
}
