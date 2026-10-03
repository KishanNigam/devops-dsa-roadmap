/* Small helpers shared by every UI module. Anything that builds HTML from data must go through escapeHtml. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Escapes text and wraps search-word matches in <mark>. Splits first so entities are never matched. */
export function highlight(text, tokens = []) {
  const t = String(text ?? '');
  if (!tokens.length) return escapeHtml(t);
  const re = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  return t.split(re).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
}

export const icon = (name, extraClass = '') =>
  `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const LEVEL_LABEL = Object.freeze({
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert',
});

export const formatHours = (h) => `${Number.isInteger(h) ? h : Math.round(h * 10) / 10}h`;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function relativeTime(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${plural(days, 'day')} ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
