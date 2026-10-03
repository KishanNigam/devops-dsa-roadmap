import { mountRoadmapPanel } from '../roadmap-panel.js';

export async function mount(container, { params, navigate }) {
  return mountRoadmapPanel(container, {
    key: 'projects',
    heading: {
      route: 'projects',
      title: 'Projects',
      subtitle: 'Practical engineering work to turn concepts into proof of execution.',
    },
  });
}
