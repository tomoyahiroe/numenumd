import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../manifest.config';
import pkg from '../package.json';

const root = resolve(__dirname, '..');

/** PNG の IHDR から実ピクセル寸法を読む(8 byte シグネチャ + 8 byte 長さ/型の後)。 */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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

// アイコンは「manifest の宣言」と「public/ 配下の実ファイル」の2箇所に分かれて
// おり、どちらかだけ直すと Chrome が黙ってプレースホルダーアイコンに
// フォールバックする(ビルドもテストも通ってしまう)。ウェブストアは 128x128 を
// 必須にしているため、宣言・実在・実寸法の3つを揃えて固定する。
describe('extension icons', () => {
  const icons = (manifest as { icons?: Record<string, string> }).icons ?? {};

  it('declares every size Chrome uses, including the store-required 128', () => {
    expect(Object.keys(icons).sort()).toEqual(['128', '16', '32', '48']);
  });

  it.each(Object.entries(icons))(
    'ships %s px as a real PNG of that exact size',
    (size, path) => {
      // manifest のパスは dist ルート基準。実体は Vite が丸ごとコピーする
      // public/ 配下にあるので、ここでは public/ を前置して実在を確かめる。
      expect(pngSize(resolve(root, 'public', path))).toEqual({
        width: Number(size),
        height: Number(size),
      });
    },
  );
});
