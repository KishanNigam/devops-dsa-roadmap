/* Entry point. Loads roadmap data, starts the store, and routes between views.

   View contract (js/views/<name>.js):
     export async function mount(container, { params, navigate }) -> optional cleanup function
   The view renders its own <h1 id="title-<name>"> into its container. */

import * as store from './store.js';
import * as storage from './storage.js';
import { toast, confirmDialog, chooseDialog } from './ui/feedback.js';
import { search } from './ui/filters.js';
import { closeDrawer } from './ui/drawer.js';
import { meterRowHtml, rollupDetail } from './ui/progress-bar.js';
import { plural } from './dom.js';

const ROUTES = {
  dashboard: { title: 'Dashboard', module: './views/dashboard.js' },
  devops: { title: 'DevOps Roadmap', module: './views/devops.js' },
  dsa: { title: 'DSA Roadmap', module: './views/dsa.js' },
  projects: { title: 'Projects', module: './views/projects.js' },
  interview: { title: 'Interview', module: './views/interview.js' },
  progress: { title: 'Progress', module: './views/progress.js' },
};
const DEFAULT_ROUTE = 'dashboard';
const SEARCHABLE_ROUTES = new Set(['devops', 'dsa', 'interview']);
const SIDEBAR_LABELS = { devops: 'DevOps and SRE', dsa: 'DSA' };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- Data loading ---------- */

async function loadJson(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`Could not fetch ${url}. ${err.message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}). Check the file exists and the name matches data/manifest.json.`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`${url} is not valid JSON: ${err.message}`);
  }
}

/** manifest.json: { roadmaps: { key: { title, description, files: ["devops/01-foundations.json", ...] } } } */
async function loadRoadmaps() {
  const manifest = await loadJson('data/manifest.json');
  const entries = Object.entries(manifest.roadmaps ?? {});
  if (!entries.length) throw new Error('data/manifest.json lists no roadmaps.');

  const loaded = await Promise.all(entries.map(async ([key, def]) => {
    const parts = await Promise.all((def.files ?? []).map((f) => loadJson(`data/${f}`)));
    return [key, { id: key, title: def.title ?? key, description: def.description ?? '', children: parts.flatMap((p) => p.children ?? []) }];
  }));
  return Object.fromEntries(loaded); // Promise.all keeps manifest order
}

function showBootError(err) {
  $('#boot-loading').hidden = true;
  const detail = location.protocol === 'file:'
    ? 'This page was opened as a local file. Browsers block loading JSON that way.'
    : err.message;
  $('#boot-error-detail').textContent = detail;
  $('#boot-error').hidden = false;
  console.error(err);
}

/* ---------- Routing ---------- */

let activeCleanup = null;
let navToken = 0;

const parseHash = () => {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : DEFAULT_ROUTE, params };
};
const navigate = (name) => { location.hash = `#/${name}`; };

async function route() {
  const token = ++navToken;
  const { name, params } = parseHash();

  closeSidebar();
  closeDrawer();
  try { activeCleanup?.(); } catch (err) { console.error('View cleanup failed', err); }
  activeCleanup = null;

  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.nav__link').forEach((a) => {
    const on = a.dataset.route === name;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${ROUTES[name].title} | Engineering Roadmap`;

  const container = $(`#view-${name}`);
  container.innerHTML = '';
  try {
    const mod = await import(ROUTES[name].module);
    if (token !== navToken) return; // user navigated away while the module loaded
    activeCleanup = (await mod.mount(container, { params, navigate })) ?? null;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty"><strong>This screen could not load</strong>${escapeText(err.message)}</div>`;
  }
  if (token === navToken) $('#main').focus({ preventScroll: true });
}

const escapeText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------- Sidebar summary and backup reminder ---------- */

function renderSidebar() {
  const rows = ['devops', 'dsa']
    .filter((k) => store.roadmapKeys().includes(k))
    .map((k) => {
      const r = store.getRootRollup(k);
      return meterRowHtml({ label: SIDEBAR_LABELS[k] ?? k, rollup: r, size: 'sm', detail: rollupDetail(r) });
    });
  $('#sidebar-summary').innerHTML = rows.join('');
}

function renderBackupStatus() {
  const b = store.backupInfo();
  const el = $('#backup-status');
  el.classList.toggle('is-stale', b.stale);
  if (!b.lastExportAt) {
    el.textContent = b.hasProgress
      ? 'No backup yet. Export your progress from the Data menu.'
      : 'Progress saves automatically in this browser.';
  } else {
    const when = b.daysSince === 0 ? 'today' : `${plural(b.daysSince, 'day')} ago`;
    el.textContent = `Last backup ${when}.${b.stale ? ' Export a new one from the Data menu.' : ''}`;
  }
}

let lastSaveErrorAt = 0;
function onStoreEvent(ev) {
  if (ev.type === 'save') {
    if (!ev.ok && Date.now() - lastSaveErrorAt > 30000) {
      lastSaveErrorAt = Date.now();
      toast('Progress could not be saved because browser storage is full or blocked. Export a backup now from the Data menu.', { type: 'error' });
    }
    return;
  }
  renderSidebar();
  renderBackupStatus();
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  storage.setTheme(next);
  applyTheme(next);
}

/* ---------- Sidebar (mobile) and data menu ---------- */

function openSidebar() {
  $('#sidebar').classList.add('is-open');
  $('#scrim').hidden = false;
}
function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
  $('#scrim').hidden = true;
}

const menuBtn = () => $('#data-menu-btn');
function setMenu(open) {
  $('#data-menu').hidden = !open;
  menuBtn().setAttribute('aria-expanded', String(open));
}

/* ---------- Data actions ---------- */

async function importFromFile(file) {
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    return toast('That file could not be read. Try exporting it again.', { type: 'error' });
  }

  // Validate before asking, so a bad file never reaches the confirm step
  try {
    storage.parseImport(text);
  } catch (err) {
    return toast(err.message, { type: 'error' });
  }

  const choice = await chooseDialog({
    title: 'Import progress',
    body: 'Merge keeps the newer record for each item and adds anything new. Replace overwrites all current progress with the file.',
    confirmLabel: 'Merge',
    altLabel: 'Replace',
  });
  if (choice === 'cancel') return;
  if (choice === 'alt') {
    const sure = await confirmDialog({
      title: 'Replace all progress?',
      body: 'Your current progress in this browser will be overwritten. Export a backup first if you might want it.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!sure) return;
  }

  try {
    const { items, unknown } = store.importProgress(text, choice === 'alt' ? 'replace' : 'merge');
    toast(`Imported ${plural(items, 'item')}.${unknown ? ` ${unknown} are not in this roadmap version and were kept.` : ''}`);
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

async function handleAction(action) {
  switch (action) {
    case 'toggle-theme': return toggleTheme();
    case 'open-sidebar': return openSidebar();
    case 'close-sidebar': return closeSidebar();
    case 'save-now':
      setMenu(false);
      return store.saveNow()
        ? toast('Progress saved in this browser.')
        : toast('Could not save. Browser storage is full or blocked.', { type: 'error' });
    case 'export-progress':
      setMenu(false);
      store.exportProgress();
      return toast('Progress exported.');
    case 'export-bundle':
      setMenu(false);
      store.exportBundle();
      return toast('Roadmap and progress exported.');
    case 'import-progress':
      setMenu(false);
      return $('#import-file').click();
    case 'reset-progress': {
      setMenu(false);
      const ok = await confirmDialog({
        title: 'Reset all progress?',
        body: 'This clears every status, note, solved count and your streak in this browser. Export a backup first if you might want it back.',
        confirmLabel: 'Reset everything',
        danger: true,
      });
      if (ok) { store.resetProgress(); toast('All progress was reset.'); }
      return;
    }
    default: return undefined; // tree rows, drawer and views handle their own actions
  }
}

function wireGlobalEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) handleAction(el.dataset.action);
    if (!ev.target.closest('.menu')) setMenu(false);
  });
  menuBtn().addEventListener('click', () => setMenu($('#data-menu').hidden));

  $('#import-file').addEventListener('change', (ev) => {
    importFromFile(ev.target.files[0]);
    ev.target.value = ''; // allow choosing the same file again
  });

  // Global search shared with every roadmap panel
  const input = $('#global-search');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search.set(input.value.trim());
      if (input.value.trim() && !SEARCHABLE_ROUTES.has(parseHash().name)) navigate('devops');
    }, 150);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { input.value = ''; search.set(''); input.blur(); }
  });

  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); input.focus(); }
    if (ev.key === 'Escape') { setMenu(false); closeSidebar(); }
  });

  window.addEventListener('hashchange', route);
}

/* ---------- Boot ---------- */

async function boot() {
  applyTheme(storage.getTheme());

  let info;
  try {
    info = store.init(await loadRoadmaps());
  } catch (err) {
    return showBootError(err);
  }

  $('#boot-loading').hidden = true;
  store.subscribe(onStoreEvent);
  wireGlobalEvents();
  renderSidebar();
  renderBackupStatus();
  await route();

  if (info.recovered) toast('Saved progress could not be read, so it was set aside. Import a backup if you have one.', { type: 'error' });
  if (!info.storageOk) toast('Browser storage is blocked, so progress will not survive a refresh. Allow site data for this address, or export regularly.', { type: 'error' });
  if (info.warnings.length) toast(`${plural(info.warnings.length, 'roadmap data warning')}. Details are in the browser console.`);
}

boot();
