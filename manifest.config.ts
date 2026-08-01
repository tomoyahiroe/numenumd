import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'numenumd',
  version: '0.1.0',
  description: 'Notion-like WYSIWYG editor for local Markdown files',
  content_scripts: [
    {
      matches: ['file:///*'],
      include_globs: ['*.md'],
      js: ['src/content/main.tsx'],
      run_at: 'document_idle',
    },
  ],
});
