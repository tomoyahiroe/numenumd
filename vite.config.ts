/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// Chrome's content-script loader (Chromium base::IsStringUTF8) rejects files
// containing Unicode noncharacters or lone surrogates even though they are
// valid UTF-8 per RFC 3629. The OXC minifier un-escapes `￿` in library
// code (e.g. linkify-it's regex bounds) into raw characters, so we re-escape
// the rejected code points in emitted JS. Escapes are equivalent to the raw
// characters in string/template/regex literals — the only places these code
// points can legally appear in JS source. Verified after every build by
// scripts/check-dist-encoding.mjs.
const escapeUnit = (ch: string) =>
  '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');

export function escapeChromeRejectedCodepoints(code: string): string {
  return (
    code
      // BMP noncharacters: U+FDD0–U+FDEF, U+FFFE, U+FFFF
      .replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, escapeUnit)
      // Supplementary noncharacters U+nFFFE/U+nFFFF (surrogate pairs whose
      // low surrogate is DFFE/DFFF and high surrogate ends in 0x3F)
      .replace(
        /[\uD83F\uD87F\uD8BF\uD8FF\uD93F\uD97F\uD9BF\uD9FF\uDA3F\uDA7F\uDABF\uDAFF\uDB3F\uDB7F\uDBBF\uDBFF][\uDFFE\uDFFF]/g,
        (pair) => escapeUnit(pair[0]!) + escapeUnit(pair[1]!),
      )
      // Lone surrogates (would serialize as invalid UTF-8 bytes)
      .replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
        escapeUnit,
      )
  );
}

function chromeSafeEncoding(): Plugin {
  return {
    name: 'numenumd:chrome-safe-encoding',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          chunk.code = escapeChromeRejectedCodepoints(chunk.code);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), chromeSafeEncoding()],
  test: {
    environment: 'jsdom',
    // `.claude/worktrees/` にはエージェント作業用の git worktree(= このリポジトリの
    // 完全なコピー)が作られることがある。git は .gitignore で無視するが vitest は
    // 見に行くため、除外しないと同じテストが二重に走り、さらにその worktree に
    // 残っている一時テストの失敗まで拾ってしまう。
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
