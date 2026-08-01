import { describe, it, expect } from 'vitest';
import manifest from '../manifest.config';
import pkg from '../package.json';

// 最終レビュー Important: バージョンが package.json(1.0.0)・
// manifest.config.ts(ハードコードの '0.1.0')・release.yml のタグ検証
// (package.json を読む)で三重に食い違い、`v0.1.0` タグではリリースが落ち、
// `v1.0.0` タグでは 0.1.0 の zip が出荷される状態だった。
// package.json を単一ソースにしたことをテストで固定する。
describe('extension manifest', () => {
  it('takes its version from package.json (release.yml のタグ検証と同じソース)', () => {
    expect((manifest as { version: string }).version).toBe(pkg.version);
  });

  it('uses a Chrome-compatible dotted numeric version', () => {
    // Chrome Web Store は 1〜4 個の数値ドット区切りしか受け付けない。
    expect(pkg.version).toMatch(/^\d+(\.\d+){0,3}$/);
  });
});
