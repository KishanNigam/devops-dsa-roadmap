import { mountRoadmapPanel } from '../roadmap-panel.js';

export async function mount(container, { params, navigate }) {
  return mountRoadmapPanel(container, {
    key: 'interview',
    heading: {
      route: 'interview',
      title: 'Interview Preparation',
      subtitle: 'Storytelling, system design, coding and communication habits for real interviews.',
    },
  });
}
