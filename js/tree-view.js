/* Expandable roadmap tree, rendered from the roadmap index.
   - Children are rendered lazily when a node is first opened, so large roadmaps stay fast.
   - One delegated click handler serves every row.
   - Store events update only the rows that changed (the leaf and its ancestors).

   Options:
     key            roadmap key in the store ('devops', 'dsa', ...)
     extraHtml(e)   optional HTML for a leaf's middle cell (DSA uses it for solved counts)
     parentMetaHtml(e)  optional extra HTML in a parent's meta line
     onExtraClick(el, entry, event)  called for clicks on elements marked data-extra
     onResult(filterResult)          called after each filter pass
*/

import * as store from './store.js';
import * as storage from './storage.js';
import { tokenize, STATUS, STATUS_LABEL } from './tree.js';
import { escapeHtml, highlight, formatHours, icon, plural, LEVEL_LABEL } from './dom.js';
import { statusControlHtml, updateStatusControl } from './status-control.js';
import { rollupHtml } from './progress-bar.js';
import { confirmDialog, toast } from './feedback.js';
import { openDrawer } from './drawer.js';

export function mountTree(container, { key, extraHtml = null, parentMetaHtml = null, onExtraClick = null, onResult = null }) {
  const index = store.getRoadmap(key).index;
  const uiName = `tree.${key}`;
  const open = new Set(storage.loadUiState(uiName).open ?? []);
  const forcedClosed = new Set(); // nodes the user closed even though a filter wanted them open
  const nodeEls = new Map();
  let filter = store.runFilter(key, {});
  let tokens = [];
  let currentId = null;

  container.classList.add('tree');

  /* ---------- Rendering ---------- */

  const isOpen = (id) => !forcedClosed.has(id) && (open.has(id) || filter.expand.has(id));
  const visibleKids = (e) => (filter.visible ? e.childIds.filter((c) => filter.visible.has(c)) : e.childIds);
  const pressedFor = (e, st) => (e.isLeaf ? st : st === STATUS.IN_PROGRESS ? null : st);

  function metaHtml(e) {
    if (!e.isLeaf) {
      const r = store.getRollup(key, e.id);
      return `<span class="node__count">${r.completed} of ${r.total} done</span>` +
        `<span class="node__hours">${formatHours(r.hoursTotal)} total</span>` +
        (parentMetaHtml ? parentMetaHtml(e) : '');
    }
    const bits = [];
    if (e.level) bits.push(`<span class="badge badge--${e.level}">${LEVEL_LABEL[e.level] ?? escapeHtml(e.level)}</span>`);
    if (e.priority === 'high') bits.push('<span class="badge badge--high">High priority</span>');
    bits.push(`<span class="node__hours">${formatHours(e.hours)}</span>`);
    if (store.getStatus(e.id) !== STATUS.COMPLETED) {
      const unmet = store.unmetPrereqs(e.id);
      if (unmet.length) {
        const names = unmet.slice(0, 2).map((u) => escapeHtml(u.title)).join(', ');
        bits.push(`<span class="node__hours">Do first: ${names}${unmet.length > 2 ? ` and ${unmet.length - 2} more` : ''}</span>`);
      }
    }
    return bits.join('');
  }

  function nodeHtml(e) {
    const st = store.nodeState(e.id);
    const opened = !e.isLeaf && isOpen(e.id);
    const title = escapeHtml(e.node.title);
    const classes = ['node', `node--d${Math.min(e.depth, 3)}`, e.isLeaf && 'node--leaf', opened && 'is-open', e.isLeaf && st === STATUS.COMPLETED && 'is-done']
      .filter(Boolean).join(' ');

    const toggle = e.isLeaf
      ? '<span class="node__spacer"></span>'
      : `<button type="button" class="node__toggle" data-action="toggle" aria-expanded="${opened}" aria-label="${opened ? 'Collapse' : 'Expand'} ${title}">${icon('chevron')}</button>`;

    const mid = e.isLeaf
      ? `<div class="node__extra">${extraHtml ? extraHtml(e) : ''}</div>`
      : `<div class="node__rollup">${rollupHtml(store.getRollup(key, e.id))}</div>`;

    const item = e.isLeaf ? store.getItem(e.id) : null;
    const tools = e.isLeaf
      ? `<div class="node__tools"><button type="button" class="icon-btn node__note-btn${item.notes || item.comments ? ' has-note' : ''}" data-action="open-detail" aria-label="Notes and details for ${title}" title="Notes and details">${icon('note')}</button></div>`
      : '<div class="node__tools"></div>';

    return `<div class="${classes}" data-id="${escapeHtml(e.id)}"><div class="node__row" style="--depth:${e.depth}">${toggle}` +
      `<div class="node__main"><div class="node__title"><span class="node__title-text">${highlight(e.node.title, tokens)}</span></div>` +
      `<div class="node__meta">${metaHtml(e)}</div></div>${mid}${statusControlHtml(e.node.title, pressedFor(e, st))}${tools}</div>` +
      `<div class="node__children">${opened ? childrenHtml(e) : ''}</div></div>`;
  }

  const childrenHtml = (e) => visibleKids(e).map((id) => nodeHtml(index.byId.get(id))).join('');
  const indexEls = (root) => root.querySelectorAll('.node').forEach((el) => nodeEls.set(el.dataset.id, el));

  function render() {
    nodeEls.clear();
    currentId = null;
    const roots = filter.visible ? index.roots.filter((id) => filter.visible.has(id)) : index.roots;
    container.innerHTML = roots.length
      ? roots.map((id) => nodeHtml(index.byId.get(id))).join('')
      : '<div class="empty"><strong>No matching items</strong>Change the search or filters to see more.</div>';
    indexEls(container);
    markCurrent();
  }

  /* ---------- Targeted updates ---------- */

  function refreshNode(id) {
    const el = nodeEls.get(id);
    if (!el) return;
    const e = index.byId.get(id);
    const st = store.nodeState(id);
    const row = el.querySelector(':scope > .node__row');

    el.classList.toggle('is-done', e.isLeaf && st === STATUS.COMPLETED);
    updateStatusControl(row.querySelector('.status'), pressedFor(e, st));
    row.querySelector('.node__meta').innerHTML = metaHtml(e);

    if (e.isLeaf) {
      const item = store.getItem(id);
      row.querySelector('.node__note-btn')?.classList.toggle('has-note', !!(item.notes || item.comments));
      if (extraHtml) {
        const extra = row.querySelector('.node__extra');
        const focused = document.activeElement?.closest?.('[data-extra]')?.dataset.extra; // keep keyboard focus across the redraw
        extra.innerHTML = extraHtml(e);
        if (focused) extra.querySelector(`[data-extra="${focused}"]`)?.focus();
      }
    } else {
      row.querySelector('.node__rollup').innerHTML = rollupHtml(store.getRollup(key, id));
    }
  }

  function markCurrent() {
    const cur = store.continueItem([key])?.id ?? null;
    if (cur === currentId) return;
    nodeEls.get(currentId)?.classList.remove('is-current');
    currentId = cur;
    nodeEls.get(cur)?.classList.add('is-current');
  }

  const unsubscribe = store.subscribe((ev) => {
    if (ev.key && ev.key !== key) return;
    if (ev.type === 'status' || ev.type === 'item' || ev.type === 'dsa') {
      const touched = new Set();
      for (const id of ev.ids) index.byId.get(id)?.idPath.forEach((a) => touched.add(a));
      touched.forEach(refreshNode);
      if (ev.type === 'status') markCurrent();
    } else if (ev.type === 'import' || ev.type === 'reset' || ev.type === 'settings') {
      nodeEls.forEach((_, id) => refreshNode(id));
      markCurrent();
    }
  });

  /* ---------- Interaction ---------- */

  const persistOpen = () => storage.saveUiState(uiName, { open: [...open] });

  function setOpen(el, e, want) {
    el.classList.toggle('is-open', want);
    const btn = el.querySelector(':scope > .node__row .node__toggle');
    btn.setAttribute('aria-expanded', String(want));
    btn.setAttribute('aria-label', `${want ? 'Collapse' : 'Expand'} ${e.node.title}`);
    if (want) {
      forcedClosed.delete(e.id);
      open.add(e.id);
      const kids = el.querySelector(':scope > .node__children');
      if (!kids.childElementCount) { kids.innerHTML = childrenHtml(e); indexEls(kids); markCurrent(); }
    } else {
      open.delete(e.id);
      if (filter.expand.has(e.id)) forcedClosed.add(e.id);
    }
    persistOpen();
  }

  async function changeStatus(e, status) {
    if (e.isLeaf) {
      store.setStatus(e.id, store.getStatus(e.id) === status ? STATUS.NOT_STARTED : status);
      return;
    }
    // On a parent the control applies to every item beneath it
    const n = e.leafIds.filter((id) => store.getStatus(id) !== status).length;
    if (!n) return;
    const label = STATUS_LABEL[status].toLowerCase();
    const ok = await confirmDialog({
      title: `Mark ${plural(n, 'item')} as ${label}?`,
      body: `This sets every item under "${e.node.title}" to ${label}. You can still change individual items afterward.`,
      confirmLabel: `Mark ${label}`,
      danger: status === STATUS.NOT_STARTED,
    });
    if (ok && store.setStatus(e.id, status)) toast(`${plural(n, 'item')} marked ${label}`);
  }

  function onClick(ev) {
    const nodeEl = ev.target.closest('.node');
    if (!nodeEl || !container.contains(nodeEl)) return;
    const e = index.byId.get(nodeEl.dataset.id);
    if (!e) return;

    const extraEl = ev.target.closest('[data-extra]');
    if (extraEl && onExtraClick) return void onExtraClick(extraEl, e, ev);

    const actionEl = ev.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'toggle') return setOpen(nodeEl, e, !nodeEl.classList.contains('is-open'));
      if (action === 'open-detail') return openDrawer(e.id, actionEl);
      if (action === 'set-status') return void changeStatus(e, actionEl.dataset.status);
    }
    // Clicking a parent's title area also opens or closes it
    if (!e.isLeaf && ev.target.closest('.node__main') && !ev.target.closest('a, button, input, select')) {
      setOpen(nodeEl, e, !nodeEl.classList.contains('is-open'));
    }
  }
  container.addEventListener('click', onClick);

  /* ---------- Public API ---------- */

  function apply(filters = {}) {
    filter = store.runFilter(key, filters);
    tokens = tokenize(filters.query);
    forcedClosed.clear();
    render();
    onResult?.(filter);
  }

  function expandAll() {
    const ids = filter.visible ? [...filter.visible] : [...index.byId.keys()];
    for (const id of ids) if (!index.byId.get(id).isLeaf) open.add(id);
    forcedClosed.clear();
    persistOpen();
    render();
  }

  function collapseAll() {
    open.clear();
    forcedClosed.clear();
    filter.expand.forEach((id) => forcedClosed.add(id));
    persistOpen();
    render();
  }

  function destroy() {
    unsubscribe();
    container.removeEventListener('click', onClick);
    container.innerHTML = '';
  }

  apply({});
  return { apply, expandAll, collapseAll, destroy, getResult: () => filter };
}
