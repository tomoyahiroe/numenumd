import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { mdToMd } from './format';
import { splitFrontmatter } from './frontmatter';

const dir = join(__dirname, '../../tests/fixtures');

describe('serialize', () => {
  it('serializes basic blocks back to markdown', () => {
    const md = '# h1\n\n- a\n- b\n\n> quote\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes taskList back as - [x] / - [ ]', () => {
    const md = '- [x] done\n- [ ] todo\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes mathBlock back as $$ fenced block', () => {
    const md = '$$\nE = mc^2\n$$\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes rawBlock content verbatim', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('restores frontmatter at head', () => {
    const md = '---\ntitle: t\n---\n\n# h\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

describe('mdToMd (golden + idempotency)', () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    it(`round-trips ${f} losslessly after one format`, async () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const once = await mdToMd(src);
      const twice = await mdToMd(once);
      expect(twice).toBe(once); // 冪等: 2回保存しても差分ゼロ
    });
  }

  it('normalizes bullets to - and headings to ATX', async () => {
    expect(await mdToMd('* item\n')).toBe('- item\n');
  });
});

// レビュー Finding 1: インライン数式($…$)の中身が esc() によって壊れる
// (`_`/`*` の常時エスケープ、`\{`/`\%` の CommonMark エスケープ解決)問題の
// 回帰テスト。parse.ts の math_inline ルールと serialize.ts の safeEsc の
// $…$ 範囲保護の両方が効いて初めて全て通る。
describe('inline math survives escaping (review finding 1)', () => {
  const cases = ['$x_{i}$\n', '$\\{a\\}$\n', '$a^{*}$\n', '$50\\%$\n'];

  for (const md of cases) {
    it(`serializes ${JSON.stringify(md)} unchanged`, () => {
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });

    it(`keeps ${JSON.stringify(md)} idempotent through mdToMd`, async () => {
      const once = await mdToMd(md);
      const twice = await mdToMd(once);
      expect(twice).toBe(once);
    });
  }
});

// レビュー Finding 2: mdToMd が frontmatter ごと Prettier に通してしまい、
// verbatim 書き戻しの原則(numenumd プロジェクトルール)に違反する問題の回帰テスト。
describe('frontmatter stays verbatim through mdToMd (review finding 2)', () => {
  it('does not let Prettier reformat a messy frontmatter block', async () => {
    const md = '---\ntitle:    Messy   \n  nested:    1\n---\n\nbody\n';
    const { frontmatter: expected } = splitFrontmatter(md);

    const once = await mdToMd(md);
    const { frontmatter: actual } = splitFrontmatter(once);

    expect(actual).toBe(expected);
  });
});

// レビュー Finding 3: 空ドキュメントで mdToMd が例外を出さないことの回帰テスト
// (serializeMarkdown の空 doc 分岐、および Prettier への空文字列入力の両方を通す)。
describe('empty document handling (review finding 3)', () => {
  it('mdToMd on an empty string resolves without throwing', async () => {
    const result = await mdToMd('');
    expect(typeof result).toBe('string');
  });
});
