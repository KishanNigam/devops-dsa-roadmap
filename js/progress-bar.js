/* Three-segment meter (completed, in progress, remaining) and the rows built from it.
   Honors the "weight by hours" setting through the store. */

import * as store from './store.js';
import { escapeHtml } from './dom.js';

export function meterHtml(r, { size = '' } = {}) {
  const weighted = store.isWeighted();
  const all = weighted ? r.hoursTotal : r.total;
  const done = weighted ? r.hoursCompleted : r.completed;
  const prog = weighted ? r.hoursInProgress : r.inProgress;
  const donePct = all ? (done / all) * 100 : 0;
  const progPct = all ? (prog / all) * 100 : 0;
  const cls = size ? `meter meter--${size}` : 'meter';
  return `<div class="${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${store.pct(r)}" aria-label="Progress">` +
    `<span class="meter__seg meter__seg--done" style="width:${donePct.toFixed(2)}%"></span>` +
    `<span class="meter__seg meter__seg--prog" style="width:${progPct.toFixed(2)}%"></span></div>`;
}

/** Compact meter plus percent, for tree rows. */
export const rollupHtml = (r) => `${meterHtml(r, { size: 'sm' })}<span class="node__pct">${store.pct(r)}%</span>`;

export const rollupDetail = (r) => `${r.completed} of ${r.total} done`;

/** Labelled row for dashboards and the sidebar. */
export function meterRowHtml({ label, rollup, detail = '', size = '' }) {
  return `<div class="meter-row"><div class="meter-row__top"><span class="meter-row__label">${escapeHtml(label)}</span>` +
    `<span class="meter-row__pct">${store.pct(rollup)}%</span></div>${meterHtml(rollup, { size })}` +
    (detail ? `<span class="meter-row__detail">${escapeHtml(detail)}</span>` : '') + '</div>';
}

export const legendHtml = () =>
  '<div class="legend"><span class="is-done">Completed</span><span class="is-prog">In progress</span><span>Not started</span></div>';
