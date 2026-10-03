/* Everything that touches the browser's storage or files lives here.
   Swapping localStorage for a real backend later means changing only this file.

   Progress shape (schemaVersion 1):
   {
     schemaVersion: 1,
     items:    { "<id>": { status, notes, comments, personalDifficulty, updatedAt, completedAt } },
     dsa:      { "<id>": { solved, stage, total?, updatedAt } },
     activity: { "2026-10-03": 4 },                  // completions per local day, drives streak and heatmap
     meta:     { lastActiveItemId, lastExportAt, lastSavedAt, weightByHours }
   }
   Unknown fields are preserved on import, so newer exports survive a round trip. */

import { STATUS, isValidStatus } from './tree.js';

export const SCHEMA_VERSION = 1;
const PROGRESS_KEY = 'roadmap.progress.v1';
const CORRUPT_KEY = 'roadmap.progress.corrupt';
const THEME_KEY = 'roadmap.theme';

const KIND_PROGRESS = 'engineering-roadmap-progress';
const KIND_BUNDLE = 'engineering-roadmap-bundle';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = (iso) => (iso ? Date.parse(iso) || 0 : 0);

/* ---------- Shape ---------- */

export function emptyProgress() {
  return {
    schemaVersion: SCHEMA_VERSION,
    items: {},
    dsa: {},
    activity: {},
    meta: { lastActiveItemId: null, lastExportAt: null, lastSavedAt: null, weightByHours: true },
  };
}

/** Fills missing fields and repairs invalid ones without throwing away anything unknown. */
export function normalizeProgress(raw) {
  const p = isObj(raw) ? raw : {};
  const out = {
    ...p,
    schemaVersion: SCHEMA_VERSION,
    items: isObj(p.items) ? { ...p.items } : {},
    dsa: isObj(p.dsa) ? { ...p.dsa } : {},
    activity: isObj(p.activity) ? { ...p.activity } : {},
    meta: { ...emptyProgress().meta, ...(isObj(p.meta) ? p.meta : {}) },
  };
  for (const [id, rec] of Object.entries(out.items)) {
    if (!isObj(rec)) { delete out.items[id]; continue; }
    if (!isValidStatus(rec.status)) out.items[id] = { ...rec, status: STATUS.NOT_STARTED };
  }
  for (const [day, n] of Object.entries(out.activity)) {
    if (!Number.isFinite(n) || n <= 0) delete out.activity[day];
  }
  return out;
}

/* ---------- localStorage ---------- */

export function storageAvailable() {
  try {
    const k = '__roadmap_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Returns { progress, recovered }. recovered=true means stored data was unreadable and was set aside. */
export function loadProgress() {
  let text = null;
  try { text = localStorage.getItem(PROGRESS_KEY); } catch { /* storage blocked */ }
  if (!text) return { progress: emptyProgress(), recovered: false };
  try {
    return { progress: normalizeProgress(JSON.parse(text)), recovered: false };
  } catch {
    // keep the unreadable text so nothing is silently lost
    try { localStorage.setItem(CORRUPT_KEY, text); } catch { /* ignore */ }
    return { progress: emptyProgress(), recovered: true };
  }
}

/** Returns { ok, error }. A failure is usually a full or blocked storage quota. */
export function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

/* ---------- Export ---------- */

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProgressFile(progress) {
  const file = { kind: KIND_PROGRESS, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), progress };
  download(`roadmap-progress-${stamp()}.json`, JSON.stringify(file, null, 2));
}

/** roadmaps: { devops: <json>, dsa: <json>, ... } exactly as loaded from data/. */
export function exportBundleFile(progress, roadmaps) {
  const file = { kind: KIND_BUNDLE, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), progress, roadmaps };
  download(`roadmap-backup-${stamp()}.json`, JSON.stringify(file, null, 2));
}

/* ---------- Import and merge ---------- */

/**
 * Accepts a progress export, a full bundle, or a bare progress object.
 * Returns normalized progress. Throws an Error whose message says what to do next.
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON. Choose a file exported from this dashboard.');
  }
  if (!isObj(data)) throw new Error('That file does not look like a progress export. Choose a file exported from this dashboard.');

  let progress = null;
  if (data.kind === KIND_PROGRESS || data.kind === KIND_BUNDLE) progress = data.progress;
  else if (isObj(data.items)) progress = data;

  if (!isObj(progress)) throw new Error('No progress data found in that file. Choose a file exported from this dashboard.');
  if (Number(progress.schemaVersion) > SCHEMA_VERSION) {
    throw new Error('That file was exported by a newer version of this dashboard. Update the app, then import it again.');
  }
  return normalizeProgress(progress);
}

/** Keeps the newer record for each id, keeps ids this app does not know, takes the larger activity count per day. */
export function mergeProgress(current, incoming) {
  const out = normalizeProgress(current);

  for (const [id, rec] of Object.entries(incoming.items)) {
    const mine = out.items[id];
    if (!mine || time(rec.updatedAt) >= time(mine.updatedAt)) out.items[id] = rec;
  }
  for (const [id, rec] of Object.entries(incoming.dsa)) {
    const mine = out.dsa[id];
    if (!mine || time(rec.updatedAt) >= time(mine.updatedAt)) out.dsa[id] = rec;
  }
  for (const [day, n] of Object.entries(incoming.activity)) {
    out.activity[day] = Math.max(out.activity[day] ?? 0, n);
  }
  return out;
}

/* ---------- UI state (not part of exported progress) ---------- */

export function loadUiState(name) {
  try { return JSON.parse(localStorage.getItem(`roadmap.ui.${name}`)) ?? {}; } catch { return {}; }
}

export function saveUiState(name, value) {
  try { localStorage.setItem(`roadmap.ui.${name}`, JSON.stringify(value)); } catch { /* ignore */ }
}
