/* A complete roadmap screen: header with overall progress, filter toolbar, summary line, and the tree.
   The DevOps, DSA and Interview views are thin wrappers around this. */

import * as store from './store.js';
import { escapeHtml, formatHours, plural } from './dom.js';
import { mountFilters, search } from './filters.js';
import { mountTree } from './tree-view.js';
import { meterRowHtml, legendHtml } from './progress-bar.js';

/**
 * heading: { route, title, subtitle } renders the page header (omit when the view supplies its own).
 * Other options pass through to mountTree. Returns a cleanup function.
 */
export function mountRoadmapPanel(container, { key, heading = null, extraHtml, parentMetaHtml, onExtraClick }) {
  container.innerHTML = `
    ${heading ? `<header class="view__head">
      <div><h1 class="view__title" id="title-${escapeHtml(heading.route)}">${escapeHtml(heading.title)}</h1>
        ${heading.subtitle ? `<p class="view__sub">${escapeHtml(heading.subtitle)}</p>` : ''}</div>
      <div class="view__overall" data-role="overall" aria-live="polite"></div>
    </header>` : ''}
    <div data-role="filters"></div>
    <p class="tree__summary" data-role="summary" aria-live="polite"></p>
    <div data-role="tree"></div>`;

  const overallEl = container.querySelector('[data-role="overall"]');
  const summaryEl = container.querySelector('[data-role="summary"]');
  let lastResult = null;

  function updateSummary() {
    const r = store.getRootRollup(key);
    if (overallEl) {
      overallEl.innerHTML = meterRowHtml({
        label: 'Overall',
        rollup: r,
        size: 'lg',
        detail: `${r.completed} of ${r.total} items done, ${formatHours(r.hoursCompleted)} of ${formatHours(r.hoursTotal)}`,
      }) + legendHtml();
    }
    if (lastResult?.active) {
      summaryEl.textContent = `Showing ${lastResult.count} of ${plural(lastResult.total, 'item')}.`;
    } else {
      summaryEl.textContent = `${plural(r.total, 'item')}: ${r.completed} completed, ${r.inProgress} in progress, ${r.notStarted} not started.`;
    }
  }

  const filters = mountFilters(container.querySelector('[data-role="filters"]'), {
    onChange: () => refilter(),
    onExpandAll: () => tree.expandAll(),
    onCollapseAll: () => tree.collapseAll(),
  });

  const tree = mountTree(container.querySelector('[data-role="tree"]'), {
    key,
    extraHtml,
    parentMetaHtml,
    onExtraClick,
    onResult: (result) => { lastResult = result; updateSummary(); },
  });

  function refilter() {
    tree.apply({ ...filters.getFilters(), query: search.value });
  }

  const unsubSearch = search.subscribe(refilter);
  const unsubStore = store.subscribe((ev) => {
    if (ev.type === 'status' || ev.type === 'import' || ev.type === 'reset' || ev.type === 'settings') updateSummary();
  });

  refilter();

  return () => {
    unsubSearch();
    unsubStore();
    tree.destroy();
    filters.destroy();
    container.innerHTML = '';
  };
}
