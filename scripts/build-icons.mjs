#!/usr/bin/env node
/**
 * assets/icon.svg から public/icons/icon-{16,32,48,128}.png を生成する。
 *
 * 生成済み PNG はリポジトリにコミットしてあるため、通常のビルド
 * (`npm run build`)やCIではこのスクリプトを実行する必要はない。
 * アイコンのデザインを変えたときだけ手元で `npm run build:icons` を回し、
 * 生成された PNG も一緒にコミットする。
 *
 * SVG → PNG のラスタライズには rsvg-convert(librsvg)または ImageMagick を使う。
 * どちらも Node の依存ではなく OS 側のツールなので、CI をこれに依存させない。
 *   brew install librsvg     # rsvg-convert
 *   brew install imagemagick # magick
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'assets/icon.svg');
const outDir = resolve(root, 'public/icons');

// Chrome が manifest.icons で使うサイズ。128 はウェブストアの掲載でも必須。
const SIZES = [16, 32, 48, 128];

function has(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { shell: '/bin/sh', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const renderer = has('rsvg-convert')
  ? (size, out) =>
      execFileSync('rsvg-convert', [
        '-w',
        String(size),
        '-h',
        String(size),
        '-o',
        out,
        src,
      ])
  : has('magick')
    ? (size, out) =>
        execFileSync('magick', [
          '-background',
          'none',
          '-density',
          String(size * 4),
          src,
          '-resize',
          `${size}x${size}`,
          out,
        ])
    : null;

if (!renderer) {
  console.error(
    'rsvg-convert も magick も見つかりません。' +
      '`brew install librsvg` か `brew install imagemagick` を実行してください。',
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const out = resolve(outDir, `icon-${size}.png`);
  renderer(size, out);
  console.log(`generated ${out}`);
}
