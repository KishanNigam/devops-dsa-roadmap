import { mountRoadmapPanel } from '../roadmap-panel.js';

export async function mount(container, { params, navigate }) {
  return mountRoadmapPanel(container, {
    key: 'dsa',
    heading: {
      route: 'dsa',
      title: 'DSA Roadmap',
      subtitle: 'A zero-to-advanced path covering structure, patterns, algorithms and interview readiness.',
    },
  });
}
