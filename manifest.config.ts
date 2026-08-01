import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

/**
 * バージョンは `package.json` を単一ソースとする。
 * `.github/workflows/release.yml` のタグ検証(`v<tag>` と package.json の
 * version の一致チェック)もここと同じ値を読むため、ここでハードコードすると
 * 「タグ検証は通るのに出荷される zip の manifest.json は別バージョン」という
 * 不整合が起きる。
 */
export default defineManifest({
  manifest_version: 3,
  name: 'numenumd',
  version: pkg.version,
  description: pkg.description,
  content_scripts: [
    {
      matches: ['file:///*'],
      include_globs: ['*.md'],
      js: ['src/content/main.tsx'],
      run_at: 'document_idle',
    },
  ],
});
