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
  /**
   * 実体は `public/icons/*.png`。Vite は `public/` の中身を dist 直下へそのまま
   * コピーするため、manifest からは `public/` を外したパスで参照する。
   * PNG は `assets/icon.svg` から `npm run build:icons` で生成する(生成物も
   * コミット済みなので、通常のビルドや CI でラスタライザは不要)。
   *
   * Chrome ウェブストアは 128x128 のアイコンを必須としており、未設定だと
   * 審査に出す前に掲載情報の保存自体が通らない。
   */
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  content_scripts: [
    {
      matches: ['file:///*'],
      include_globs: ['*.md'],
      js: ['src/content/main.tsx'],
      run_at: 'document_idle',
    },
  ],
});
