import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ストア掲載画像を撮るためだけのビルド。crx プラグインを外し、content script と
 * してではなく普通のページとして src/content/App をマウントする(描画される
 * UI と CSS は拡張機能本体と同一)。詳しい経緯は capture.mjs のコメント参照。
 *
 * 出力先の out/ は capture.mjs が撮影後に削除するため、成果物は
 * docs/store-assets/*.png だけが残る。
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'out',
    emptyOutDir: true,
    // index.html(エディタ本体)と promo.html(プロモタイル)の2ページ構成。
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        promo: resolve(import.meta.dirname, 'promo.html'),
      },
    },
  },
});
