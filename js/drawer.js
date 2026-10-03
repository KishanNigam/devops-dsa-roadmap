/* Details drawer for a single leaf: status, prerequisites, DSA tracking, notes, personal comments.
   Notes save as you type (the store debounces the actual write). */

import * as store from './store.js';
import { STATUS_LABEL } from './tree.js';
import { escapeHtml, icon, formatHours, relativeTime, LEVEL_LABEL } from './dom.js';
import { statusControlHtml, updateStatusControl } from './status-control.js';

const PERSONAL_DIFFICULTY = [
  ['', 'Not set'], ['easy', 'Felt easy'], ['fair', 'About right'], ['hard', 'Felt hard'],
];
const CLOSE_MS = 230;

let openId = null;
let opener = null;
let unsubscribe = null;
let closeTimer = null;

const drawerEl = () => document.getElementById('drawer');

export function openDrawer(id, openerEl = null) {
  const entry = store.getEntry(id);
  if (!entry || !entry.isLeaf) return;

  openId = id;
  opener = openerEl ?? document.activeElement;
  clearTimeout(closeTimer);

  const el = drawerEl();
  el.innerHTML = drawerHtml(entry);
  el.hidden = false;
  el.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    el.querySelector('.drawer__title')?.focus();
  });

  unsubscribe?.();
  unsubscribe = store.subscribe(onStoreEvent);
}

export function closeDrawer() {
  if (!openId) return;
  const el = drawerEl();
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  closeTimer = setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, CLOSE_MS);
  unsubscribe?.();
  unsubscribe = null;
  openId = null;
  opener?.focus?.();
  opener = null;
}

function drawerHtml(e) {
  const item = store.getItem(e.id);
  const unmet = store.unmetPrereqs(e.id);
  const t = escapeHtml(e.node.title);

  const badges = [
    e.level ? `<span class="badge badge--${e.level}">${LEVEL_LABEL[e.level] ?? escapeHtml(e.level)}</span>` : '',
    e.priority ? `<span class="badge${e.priority === 'high' ? ' badge--high' : ''}">${escapeHtml(e.priority)} priority</span>` : '',
    `<span class="badge">${formatHours(e.hours)}</span>`,
  ].join('');

  const prereqs = unmet.length
    ? `<div class="drawer__field"><span class="drawer__label">Do these first</span><ul>${unmet.map((u) => `<li>${escapeHtml(u.title)}</li>`).join('')}</ul></div>`
    : '';

  const options = PERSONAL_DIFFICULTY
    .map(([v, label]) => `<option value="${v}"${(item.personalDifficulty ?? '') === v ? ' selected' : ''}>${label}</option>`)
    .join('');

  return `
    <div class="drawer__head">
      <div>
        <h2 class="drawer__title" tabindex="-1">${t}</h2>
        <p class="drawer__path">${escapeHtml(e.titlePath.slice(0, -1).join(' / '))}</p>
      </div>
      <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Close details">${icon('close')}</button>
    </div>
    <div class="drawer__meta">${badges}</div>
    ${e.node.description ? `<p>${escapeHtml(e.node.description)}</p>` : ''}
    <div class="drawer__field"><span class="drawer__label">Status</span>${statusControlHtml(e.node.title, item.status)}<span class="meter-row__detail" data-role="when">${whenText(item)}</span></div>
    ${prereqs}
    ${e.rootKey === 'dsa' ? dsaHtml(e.id) : ''}
    <div class="drawer__field"><label for="d-notes">Notes</label>
      <textarea id="d-notes" data-field="notes" placeholder="What you learned, commands worth remembering, links">${escapeHtml(item.notes)}</textarea></div>
    <div class="drawer__field"><label for="d-comments">Personal comments</label>
      <textarea id="d-comments" data-field="comments" placeholder="Why this matters to you, what to revisit">${escapeHtml(item.comments)}</textarea></div>
    <div class="drawer__field"><label for="d-diff">How hard did this feel?</label>
      <select id="d-diff" data-field="personalDifficulty">${options}</select></div>`;
}

function dsaHtml(id) {
  const d = store.getDsa(id);
  const stages = store.DSA_STAGES
    .map((s) => `<option value="${s}"${d.stage === s ? ' selected' : ''}>${store.DSA_STAGE_LABEL[s]}</option>`)
    .join('');
  return `
    <div class="drawer__field"><label for="d-solved">Problems solved${d.total ? ` (of ${d.total})` : ''}</label>
      <div class="solved">
        <button type="button" class="solved__btn" data-dsa="dec" aria-label="One fewer">&minus;</button>
        <input id="d-solved" class="solved__input" type="number" min="0"${d.total ? ` max="${d.total}"` : ''} value="${d.solved}" data-dsa="input">
        <button type="button" class="solved__btn" data-dsa="inc" aria-label="One more">+</button>
      </div>
      <span class="meter-row__detail" data-role="remaining">${d.total ? `${d.remaining} remaining` : 'No problem count set for this topic'}</span></div>
    <div class="drawer__field"><label for="d-stage">Stage</label>
      <select id="d-stage" data-dsa="stage">${stages}</select></div>`;
}

function whenText(item) {
  if (item.status === 'completed' && item.completedAt) return `Completed ${relativeTime(item.completedAt)}`;
  if (item.updatedAt && item.status !== 'not_started') return `${STATUS_LABEL[item.status]}, updated ${relativeTime(item.updatedAt)}`;
  return '';
}

function onStoreEvent(ev) {
  if (!openId) return;
  const el = drawerEl();

  if (ev.type === 'import' || ev.type === 'reset') {
    const entry = store.getEntry(openId);
    if (entry) el.innerHTML = drawerHtml(entry);
    return;
  }
  if (ev.type === 'status' && ev.ids?.includes(openId)) {
    const item = store.getItem(openId);
    updateStatusControl(el.querySelector('.status'), item.status);
    const when = el.querySelector('[data-role="when"]');
    if (when) when.textContent = whenText(item);
  }
  if (ev.type === 'dsa' && ev.ids?.includes(openId)) {
    const d = store.getDsa(openId);
    const input = el.querySelector('[data-dsa="input"]');
    if (input && document.activeElement !== input) input.value = d.solved;
    const rem = el.querySelector('[data-role="remaining"]');
    if (rem && d.total) rem.textContent = `${d.remaining} remaining`;
  }
}

/* One set of listeners for the lifetime of the page; the drawer element persists. */
drawerEl()?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || !openId) return;
  if (btn.dataset.action === 'close-drawer') return closeDrawer();
  if (btn.dataset.action === 'set-status') {
    const cur = store.getStatus(openId);
    return void store.setStatus(openId, cur === btn.dataset.status ? 'not_started' : btn.dataset.status);
  }
  if (btn.dataset.dsa === 'inc' || btn.dataset.dsa === 'dec') {
    const { solved } = store.getDsa(openId);
    store.setSolved(openId, solved + (btn.dataset.dsa === 'inc' ? 1 : -1));
  }
});

drawerEl()?.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!openId) return;
  if (t.dataset.field === 'notes' || t.dataset.field === 'comments') store.setItemFields(openId, { [t.dataset.field]: t.value });
});

drawerEl()?.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!openId) return;
  if (t.dataset.field === 'personalDifficulty') store.setItemFields(openId, { personalDifficulty: t.value || null });
  if (t.dataset.dsa === 'stage') store.setStage(openId, t.value);
  if (t.dataset.dsa === 'input') store.setSolved(openId, t.value);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && openId && !document.querySelector('dialog[open]')) closeDrawer();
});
