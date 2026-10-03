import { mountRoadmapPanel } from '../roadmap-panel.js';

export async function mount(container, { params, navigate }) {
  return mountRoadmapPanel(container, {
    key: 'devops',
    heading: {
      route: 'devops',
      title: 'DevOps Roadmap',
      subtitle: 'Linux, networking, AWS, containers, Kubernetes, IaC, CI/CD and SRE foundations.',
    },
  });
}
