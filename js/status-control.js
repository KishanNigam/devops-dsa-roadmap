/* The three-state status control used on every row and in the details drawer.
   Buttons carry data-action="set-status" and data-status; the owner of the container handles clicks. */

import { STATUS_LIST, STATUS_LABEL } from './tree.js';
import { escapeHtml, icon } from './dom.js';

const GLYPH = {
  not_started: '<span class="status__dot"></span>',
  in_progress: icon('play'),
  completed: icon('check'),
};

/** pressed: a status string, or null when a parent row is a mix and no single state applies. */
export function statusControlHtml(title, pressed) {
  const buttons = STATUS_LIST.map((s) => (
    `<button type="button" class="status__btn" data-action="set-status" data-status="${s}" ` +
    `aria-pressed="${s === pressed}" title="${STATUS_LABEL[s]}" aria-label="${STATUS_LABEL[s]}">${GLYPH[s]}</button>`
  )).join('');
  return `<div class="status" role="group" aria-label="Status of ${escapeHtml(title)}">${buttons}</div>`;
}

export function updateStatusControl(el, pressed) {
  if (!el) return;
  el.querySelectorAll('.status__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === pressed)));
}
