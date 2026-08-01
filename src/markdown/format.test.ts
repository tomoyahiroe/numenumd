import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse';
import { docToMd, mdToMd } from './format';

describe('docToMd', () => {
  it('formats the body but leaves frontmatter verbatim, matching mdToMd on the equivalent markdown', async () => {
    const md = '---\ntitle:    Messy\n---\n\n*   loose item\n';
    const doc = parseMarkdown(md);
    const viaDoc = await docToMd(doc);
    const viaMd = await mdToMd(md);
    expect(viaDoc).toBe(viaMd);
    // frontmatter は Prettier に通されず verbatim のまま(余分な空白も保持される)
    expect(viaDoc).toContain('title:    Messy');
  });

  it('never needs a re-parse of the serialized markdown (works directly from JSONContent)', async () => {
    const doc = parseMarkdown('# Hello\n\nworld\n');
    expect(await docToMd(doc)).toBe('# Hello\n\nworld\n');
  });

  it('produces a trailing newline and no leading/trailing blank noise for an empty doc', async () => {
    const doc = parseMarkdown('');
    expect(await docToMd(doc)).toBe('\n');
  });
});
