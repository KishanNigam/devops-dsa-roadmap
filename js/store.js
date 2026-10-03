/* Single source of truth. Views never touch storage or compute progress themselves:
   they call the functions below and re-render when subscribe() fires.

   Events passed to subscribers:
     { type: 'status',   key, ids }   status of one or more leaves changed
     { type: 'item',     key, ids }   notes, comments or personal difficulty changed
     { type: 'dsa',      key, ids }   solved count or stage changed
     { type: 'settings' }             weighting changed
     { type: 'import' | 'reset' | 'export' }
     { type: 'save',     ok, error?, at }  result of a (debounced or manual) save */

import {
  STATUS, isValidStatus, buildIndex, findDanglingPrereqs, Rollups, percent, derivedStatus,
  filterTree, problemTotal, blankRollup, addRollup,
} from './tree.js';
import * as storage from './storage.js';

const SAVE_DELAY_MS = 300;
const BACKUP_STALE_DAYS = 14;

export const DSA_STAGES = Object.freeze(['learn', 'practice', 'revision', 'interview_ready']);
export const DSA_STAGE_LABEL = Object.freeze({
  learn: 'Learn', practice: 'Practice', revision: 'Revision', interview_ready: 'Interview ready',
});

let state = null;
let saveTimer = null;
const listeners = new Set();

/* ---------- Setup ---------- */

/**
 * roadmapData: { devops: <json>, dsa: <json>, projects: <json>, ... }
 * Returns { warnings, recovered, storageOk }.
 */
export function init(roadmapData) {
  const { progress, recovered } = storage.loadProgress();
  const roadmaps = {};
  const owner = new Map(); // id -> roadmap key
  const warnings = [];

  for (const [key, data] of Object.entries(roadmapData)) {
    const index = buildIndex(data, key);
    warnings.push(...index.warnings);
    for (const id of index.byId.keys()) {
      if (owner.has(id)) warnings.push(`Id "${id}" is used in both "${owner.get(id)}" and "${key}". Progress would be shared.`);
      else owner.set(id, key);
    }
    roadmaps[key] = { data, index, rollups: null };
  }
  warnings.push(...findDanglingPrereqs(Object.values(roadmaps).map((r) => r.index)));

  state = { roadmaps, owner, progress, warnings };
  for (const rm of Object.values(roadmaps)) rm.rollups = new Rollups(rm.index, getStatus);

  // Flush any pending save when the tab is hidden or closed
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushIfPending(); });
  window.addEventListener('pagehide', flushIfPending);

  if (warnings.length) console.warn(`Roadmap data warnings (${warnings.length}):\n` + warnings.join('\n'));
  return { warnings, recovered, storageOk: storage.storageAvailable() };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) { console.error('Subscriber failed', err); }
  }
}

/* ---------- Reading ---------- */

export const roadmapKeys = () => Object.keys(state.roadmaps);
export const getRoadmap = (key) => state.roadmaps[key];
export const getWarnings = () => state.warnings;

function lookup(id) {
  const key = state.owner.get(id);
  if (!key) return null;
  const entry = state.roadmaps[key].index.byId.get(id);
  return entry ? { key, entry } : null;
}
export const getEntry = (id) => lookup(id)?.entry ?? null;

export function getStatus(id) {
  return state.progress.items[id]?.status ?? STATUS.NOT_STARTED;
}

export function getItem(id) {
  const rec = state.progress.items[id];
  return {
    status: rec?.status ?? STATUS.NOT_STARTED,
    notes: rec?.notes ?? '',
    comments: rec?.comments ?? '',
    personalDifficulty: rec?.personalDifficulty ?? null,
    updatedAt: rec?.updatedAt ?? null,
    completedAt: rec?.completedAt ?? null,
  };
}

export const getRollup = (key, id) => state.roadmaps[key].rollups.get(id);
export const getRootRollup = (key) => state.roadmaps[key].rollups.root;

/** What to show for any row: the stored status for leaves, a derived one for parents. */
export function nodeState(id) {
  const hit = lookup(id);
  if (!hit) return STATUS.NOT_STARTED;
  return hit.entry.isLeaf ? getStatus(id) : derivedStatus(getRollup(hit.key, id));
}

export const isWeighted = () => state.progress.meta.weightByHours !== false;
export const pct = (rollup) => percent(rollup, isWeighted());

export function setWeighted(on) {
  state.progress.meta.weightByHours = !!on;
  scheduleSave();
  emit({ type: 'settings' });
}

export function runFilter(key, filters) {
  return filterTree(state.roadmaps[key].index, filters, getStatus);
}

/** Prerequisites that are not finished yet: [{ id, title }]. A hint only; nothing is ever locked. */
export function unmetPrereqs(id) {
  const hit = lookup(id);
  if (!hit) return [];
  const unmet = [];
  for (const pid of hit.entry.node.prereqs ?? []) {
    const p = lookup(pid);
    if (!p) continue;
    const done = p.entry.isLeaf
      ? getStatus(pid) === STATUS.COMPLETED
      : (() => { const r = getRollup(p.key, pid); return r.total > 0 && r.completed === r.total; })();
    if (!done) unmet.push({ id: pid, title: p.entry.node.title });
  }
  return unmet;
}

/* ---------- Writing: status ---------- */

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function bumpActivity(date, delta) {
  const k = dayKey(date);
  const next = (state.progress.activity[k] ?? 0) + delta;
  if (next > 0) state.progress.activity[k] = next;
  else delete state.progress.activity[k];
}

const hasUserContent = (rec) => !!(rec.notes || rec.comments || rec.personalDifficulty);

/**
 * Sets the status of a leaf. Passing a parent id applies the status to every leaf beneath it
 * (the "mark section complete" action). Returns true if anything changed.
 */
export function setStatus(id, status) {
  if (!isValidStatus(status)) throw new Error(`Invalid status "${status}"`);
  const hit = lookup(id);
  if (!hit) return false;
  const targets = hit.entry.isLeaf ? [id] : hit.entry.leafIds;

  const now = new Date();
  const iso = now.toISOString();
  const items = state.progress.items;
  const changed = [];

  for (const leafId of targets) {
    const prev = items[leafId];
    const prevStatus = prev?.status ?? STATUS.NOT_STARTED;
    if (prevStatus === status) continue;

    const rec = prev ? { ...prev } : { notes: '', comments: '', personalDifficulty: null };
    if (prevStatus === STATUS.COMPLETED && prev?.completedAt) bumpActivity(new Date(prev.completedAt), -1);

    rec.status = status;
    rec.updatedAt = iso;
    rec.completedAt = status === STATUS.COMPLETED ? iso : null;
    if (status === STATUS.COMPLETED) bumpActivity(now, +1);

    // do not keep empty records for untouched items; keeps storage small
    if (status === STATUS.NOT_STARTED && !hasUserContent(rec)) delete items[leafId];
    else items[leafId] = rec;
    changed.push(leafId);
  }

  if (!changed.length) return false;
  if (status !== STATUS.NOT_STARTED) state.progress.meta.lastActiveItemId = changed[changed.length - 1];
  state.roadmaps[hit.key].rollups.update(changed);
  scheduleSave();
  emit({ type: 'status', key: hit.key, ids: changed });
  return true;
}

/** patch may contain: notes, comments, personalDifficulty */
export function setItemFields(id, patch) {
  const hit = lookup(id);
  if (!hit) return false;
  const allowed = ['notes', 'comments', 'personalDifficulty'];
  const prev = state.progress.items[id];
  const rec = prev ? { ...prev } : { status: STATUS.NOT_STARTED, notes: '', comments: '', personalDifficulty: null };
  for (const k of allowed) if (k in patch) rec[k] = patch[k];
  rec.updatedAt = new Date().toISOString();

  if (rec.status === STATUS.NOT_STARTED && !hasUserContent(rec)) delete state.progress.items[id];
  else state.progress.items[id] = rec;

  scheduleSave();
  emit({ type: 'item', key: hit.key, ids: [id] });
  return true;
}

/* ---------- Writing: DSA problem tracking ---------- */

export function getDsa(id) {
  const hit = lookup(id);
  const rec = state.progress.dsa[id];
  const total = rec?.total ?? (hit ? problemTotal(hit.entry.node) : 0);
  const solved = Math.min(rec?.solved ?? 0, total || Infinity);
  return { solved, total, remaining: Math.max(0, total - solved), stage: rec?.stage ?? 'learn' };
}

/** Solved / total / remaining across every leaf under a node. */
export function dsaTotals(id) {
  const hit = lookup(id);
  if (!hit) return { solved: 0, total: 0, remaining: 0 };
  const ids = hit.entry.isLeaf ? [id] : hit.entry.leafIds;
  let solved = 0;
  let total = 0;
  for (const leafId of ids) {
    const d = getDsa(leafId);
    solved += d.solved;
    total += d.total;
  }
  return { solved, total, remaining: Math.max(0, total - solved) };
}

/** Clamped to 0..total. Logging a first solved problem moves a not-started topic to in progress. */
export function setSolved(id, count) {
  const hit = lookup(id);
  if (!hit) return false;
  const { total, stage } = getDsa(id);
  const max = total > 0 ? total : Infinity;
  const solved = Math.max(0, Math.min(Math.round(Number(count) || 0), max));
  const prev = state.progress.dsa[id];
  if ((prev?.solved ?? 0) === solved) return false;

  state.progress.dsa[id] = { ...(prev ?? {}), solved, stage, updatedAt: new Date().toISOString() };
  if (hit.entry.isLeaf && solved > 0 && getStatus(id) === STATUS.NOT_STARTED) setStatus(id, STATUS.IN_PROGRESS);
  scheduleSave();
  emit({ type: 'dsa', key: hit.key, ids: [id] });
  return true;
}

export function setStage(id, stage) {
  const hit = lookup(id);
  if (!hit || !DSA_STAGES.includes(stage)) return false;
  const prev = state.progress.dsa[id];
  state.progress.dsa[id] = { solved: 0, ...(prev ?? {}), stage, updatedAt: new Date().toISOString() };
  scheduleSave();
  emit({ type: 'dsa', key: hit.key, ids: [id] });
  return true;
}

/* ---------- Dashboard queries ---------- */

function entriesWithStatus(status, orderField, keys, limit) {
  const wanted = keys ? new Set(keys) : null;
  return Object.entries(state.progress.items)
    .filter(([, rec]) => rec.status === status && rec[orderField])
    .map(([id, rec]) => ({ id, rec, hit: lookup(id) }))
    .filter(({ hit }) => hit && (!wanted || wanted.has(hit.key)))
    .sort((a, b) => Date.parse(b.rec[orderField]) - Date.parse(a.rec[orderField]))
    .slice(0, limit)
    .map(({ id, rec, hit }) => ({ id, key: hit.key, entry: hit.entry, at: rec[orderField] }));
}

export const recentlyCompleted = (limit = 8, keys) => entriesWithStatus(STATUS.COMPLETED, 'completedAt', keys, limit);
export const currentlyLearning = (limit = 8, keys) => entriesWithStatus(STATUS.IN_PROGRESS, 'updatedAt', keys, limit);
export const continueItem = (keys) => currentlyLearning(1, keys)[0] ?? null;

/** Phase to show as "current" for a roadmap: where you last worked, else the first unfinished phase. */
export function currentPhase(key) {
  const rm = state.roadmaps[key];
  const last = currentlyLearning(1, [key])[0];
  if (last) return rm.index.byId.get(last.entry.idPath[0]);
  for (const id of rm.index.roots) {
    const r = rm.rollups.get(id);
    if (r.completed < r.total) return rm.index.byId.get(id);
  }
  return null;
}

/** Sum of root rollups for the given roadmap keys (default: the two learning roadmaps). */
export function totals(keys = ['devops', 'dsa']) {
  const sum = blankRollup();
  for (const k of keys) if (state.roadmaps[k]) addRollup(sum, state.roadmaps[k].rollups.root);
  return sum;
}

/* ---------- Streak and heatmap ---------- */

const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

export function streakInfo(today = new Date()) {
  const act = state.progress.activity;
  const has = (d) => (act[dayKey(d)] ?? 0) > 0;

  // current: count back from today, or from yesterday if nothing is done yet today
  let current = 0;
  const cursor = new Date(today);
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1);
  while (has(cursor)) { current++; cursor.setDate(cursor.getDate() - 1); }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of Object.keys(act).filter((d) => act[d] > 0).sort()) {
    if (prev) {
      const next = parseDay(prev);
      next.setDate(next.getDate() + 1);
      run = dayKey(next) === k ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest };
}

/** Last `weeks` weeks for the heatmap. Leading nulls pad so the first real cell lands on its weekday row. */
export function activityDays(weeks = 26, today = new Date()) {
  const n = weeks * 7;
  const start = new Date(today);
  start.setDate(start.getDate() - (n - 1));
  const cells = Array(start.getDay()).fill(null);
  const level = (c) => (c <= 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4);
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const count = state.progress.activity[dayKey(d)] ?? 0;
    cells.push({ date: dayKey(d), count, level: level(count) });
  }
  return cells;
}

/* ---------- Saving, export, import, reset ---------- */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}

function flushIfPending() {
  if (saveTimer) flush();
}

/** Writes progress now. Also used by the "Save progress" menu item. Returns true on success. */
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  state.progress.meta.lastSavedAt = new Date().toISOString();
  const result = storage.saveProgress(state.progress);
  emit({ type: 'save', ok: result.ok, error: result.error, at: state.progress.meta.lastSavedAt });
  return result.ok;
}
export const saveNow = flush;

function rebuildAll() {
  for (const rm of Object.values(state.roadmaps)) rm.rollups.rebuild();
}

export function exportProgress() {
  storage.exportProgressFile(state.progress);
  state.progress.meta.lastExportAt = new Date().toISOString();
  flush();
  emit({ type: 'export' });
}

export function exportBundle() {
  const roadmaps = Object.fromEntries(Object.entries(state.roadmaps).map(([k, rm]) => [k, rm.data]));
  storage.exportBundleFile(state.progress, roadmaps);
  state.progress.meta.lastExportAt = new Date().toISOString();
  flush();
  emit({ type: 'export' });
}

/**
 * mode 'merge' keeps the newer record per item; 'replace' swaps everything.
 * Throws an Error with a user-facing message on bad files.
 * Returns { items, unknown } where unknown counts ids this roadmap version does not contain (kept, not lost).
 */
export function importProgress(text, mode = 'merge') {
  const incoming = storage.parseImport(text);
  state.progress = mode === 'replace' ? incoming : storage.mergeProgress(state.progress, incoming);
  rebuildAll();
  flush();
  emit({ type: 'import' });
  const ids = Object.keys(incoming.items);
  return { items: ids.length, unknown: ids.filter((id) => !state.owner.has(id)).length };
}

export function resetProgress() {
  state.progress = storage.emptyProgress();
  rebuildAll();
  flush();
  emit({ type: 'reset' });
}

/** For the backup reminder in the sidebar. */
export function backupInfo() {
  const { lastExportAt } = state.progress.meta;
  const hasProgress = Object.keys(state.progress.items).length > 0;
  const days = lastExportAt ? Math.floor((Date.now() - Date.parse(lastExportAt)) / 86_400_000) : null;
  return { lastExportAt, daysSince: days, hasProgress, stale: hasProgress && (days === null || days >= BACKUP_STALE_DAYS) };
}
