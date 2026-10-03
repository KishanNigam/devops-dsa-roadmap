/* Shared search state plus the filter toolbar (status, level, expand/collapse, weighting). */

import * as store from './store.js';
import { LEVELS, STATUS_LIST, STATUS_LABEL } from './tree.js';
import { LEVEL_LABEL } from './dom.js';

/* The top-bar search box and every roadmap panel share one query. */
let query = '';
const subscribers = new Set();
export const search = {
  get value() { return query; },
  set(v) {
    const next = String(v ?? '');
    if (next === query) return;
    query = next;
    subscribers.forEach((fn) => fn(query));
  },
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

const chip = (attr, value, label) => `<button type="button" class="chip" ${attr}="${value}" aria-pressed="false">${label}</button>`;

/**
 * Renders the toolbar into container.
 * onChange fires when status or level changes; getFilters() returns { status, levels }.
 */
export function mountFilters(container, { onChange, onExpandAll, onCollapseAll, showLevels = true }) {
  const state = { status: 'all', levels: new Set() };

  const statusChips = [chip('data-status-chip', 'all', 'All'), ...STATUS_LIST.map((s) => chip('data-status-chip', s, STATUS_LABEL[s]))].join('');
  const levelChips = LEVELS.map((l) => chip('data-level-chip', l, LEVEL_LABEL[l])).join('');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__group"><span class="toolbar__label">Status</span><div class="chips">${statusChips}</div></div>
      ${showLevels ? `<div class="toolbar__group"><span class="toolbar__label">Level</span><div class="chips">${levelChips}</div></div>` : ''}
      <div class="toolbar__group toolbar__spacer">
        <button type="button" class="btn btn--sm btn--ghost" data-role="clear" hidden>Clear filters</button>
        <button type="button" class="btn btn--sm" data-role="expand">Expand all</button>
        <button type="button" class="btn btn--sm" data-role="collapse">Collapse all</button>
        <label class="toolbar__label"><input type="checkbox" data-role="weighted"> Weight progress by hours</label>
      </div>
    </div>`;

  const weighted = container.querySelector('[data-role="weighted"]');
  const clear = container.querySelector('[data-role="clear"]');
  weighted.checked = store.isWeighted();

  function sync() {
    container.querySelectorAll('[data-status-chip]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.statusChip === state.status)));
    container.querySelectorAll('[data-level-chip]').forEach((b) => b.setAttribute('aria-pressed', String(state.levels.has(b.dataset.levelChip))));
    clear.hidden = !(state.status !== 'all' || state.levels.size || query);
  }

  container.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.statusChip) { state.status = b.dataset.statusChip; sync(); onChange(); }
    else if (b.dataset.levelChip) {
      const l = b.dataset.levelChip;
      if (state.levels.has(l)) state.levels.delete(l); else state.levels.add(l);
      sync(); onChange();
    } else if (b.dataset.role === 'clear') {
      state.status = 'all'; state.levels.clear(); sync();
      if (query) search.set(''); // search subscribers re-filter
      else onChange();
      const input = document.getElementById('global-search');
      if (input) input.value = '';
    } else if (b.dataset.role === 'expand') onExpandAll?.();
    else if (b.dataset.role === 'collapse') onCollapseAll?.();
  });
  weighted.addEventListener('change', () => store.setWeighted(weighted.checked));

  const unsubSearch = search.subscribe(sync);
  sync();

  return {
    getFilters: () => ({ status: state.status, levels: new Set(state.levels) }),
    destroy: () => { unsubSearch(); container.innerHTML = ''; },
  };
}
