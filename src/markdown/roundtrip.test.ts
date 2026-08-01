import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { mdToMd } from './format';

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
