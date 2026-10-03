import * as store from '../store.js';
import { meterRowHtml, rollupDetail } from '../ui/progress-bar.js';
import { plural } from '../dom.js';

function renderRows() {
  const devops = store.getRootRollup('devops');
  const dsa = store.getRootRollup('dsa');
  return [
    meterRowHtml({ label: 'DevOps and SRE', rollup: devops, size: 'lg', detail: rollupDetail(devops) }),
    meterRowHtml({ label: 'DSA', rollup: dsa, size: 'lg', detail: rollupDetail(dsa) }),
  ].join('');
}

export async function mount(container, { params, navigate }) {
  const render = () => {
    const devops = store.getRootRollup('devops');
    const dsa = store.getRootRollup('dsa');
    const recent = store.recentlyCompleted(4);
    const active = store.currentPhase('devops') || store.currentPhase('dsa');

    container.innerHTML = `
      <header class="view__head">
        <div>
          <h1 class="view__title" id="title-dashboard">Learning Dashboard</h1>
          <p class="view__sub">Track the roadmap, measure momentum and keep your learning plan moving.</p>
        </div>
      </header>
      <div class="grid grid--2">
        <section class="card">
          <h2>Overall progress</h2>
          <div class="stack">
            ${renderRows()}
          </div>
        </section>
        <section class="card">
          <h2>Current focus</h2>
          <p>${active ? `You are working on <strong>${active.node.title}</strong>.` : 'No active phase yet. Start with the first unfinished topic.'}</p>
          <div class="stack">
            <div class="stat"><span>${plural(devops.completed, 'completed item')}</span><strong>${devops.completed}/${devops.total}</strong></div>
            <div class="stat"><span>${plural(dsa.completed, 'completed DSA item')}</span><strong>${dsa.completed}/${dsa.total}</strong></div>
          </div>
        </section>
      </div>
      <section class="card">
        <h2>Recently completed</h2>
        ${recent.length ? `<ul class="list">${recent.map((item) => `<li>${item.entry.node.title}</li>`).join('')}</ul>` : '<p class="empty">No items completed yet.</p>'}
      </section>
    `;
  };

  render();
  const unsub = store.subscribe((ev) => {
    if (['status', 'dsa', 'import', 'reset', 'settings'].includes(ev.type)) render();
  });
  return () => unsub();
}
