import { createRoot } from 'react-dom/client';
import { App } from '../../src/content/App';
import math from './docs/math.md?raw';
import blocks from './docs/blocks.md?raw';
import preserve from './docs/preserve.md?raw';
import slash from './docs/slash.md?raw';

const DOCS: Record<string, { md: string; filename: string }> = {
  math: { md: math, filename: 'wave-equation.md' },
  blocks: { md: blocks, filename: 'sprint-notes.md' },
  preserve: { md: preserve, filename: 'release-checklist.md' },
  slash: { md: slash, filename: 'meeting-2026-08-08.md' },
};

const key = new URLSearchParams(location.search).get('doc') ?? 'math';
const doc = DOCS[key] ?? DOCS.math!;

createRoot(document.getElementById('numenumd-root')!).render(
  <App rawMarkdown={doc.md} filename={doc.filename} />,
);
