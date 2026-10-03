import * as store from '../store.js';
import { meterRowHtml, rollupDetail } from '../ui/progress-bar.js';

export async function mount(container, { params, navigate }) {
  const render = () => {
    const rows = ['devops', 'dsa', 'projects', 'interview']
      .filter((key) => store.getRoadmap(key))
      .map((key) => {
        const rollup = store.getRootRollup(key);
        return meterRowHtml({ label: store.getRoadmap(key).data.title, rollup, size: 'lg', detail: rollupDetail(rollup) });
      })
      .join('');

    container.innerHTML = `
      <header class="view__head">
        <div>
          <h1 class="view__title" id="title-progress">Progress</h1>
          <p class="view__sub">Track completion across every roadmap and project track.</p>
        </div>
      </header>
      <section class="card">
        <div class="stack">${rows}</div>
      </section>
    `;
  };

  render();
  const unsub = store.subscribe((ev) => {
    if (['status', 'dsa', 'import', 'reset', 'settings'].includes(ev.type)) render();
  });
  return () => unsub();
}
