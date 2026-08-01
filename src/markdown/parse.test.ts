import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse';
import { splitFrontmatter } from './frontmatter';

const types = (md: string) =>
  (parseMarkdown(md).content ?? []).map((n) => n.type);

describe('parseMarkdown', () => {
  it('parses headings, lists, quote, code', () => {
    expect(types('# h1\n\n- a\n\n> q\n\n```js\nx\n```')).toEqual([
      'heading',
      'bulletList',
      'blockquote',
      'codeBlock',
    ]);
  });

  it('parses task list items with checked state', () => {
    const doc = parseMarkdown('- [x] done\n- [ ] todo');
    const list = doc.content?.[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content?.[0]?.attrs?.checked).toBe(true);
    expect(list?.content?.[1]?.attrs?.checked).toBe(false);
  });

  it('parses inline marks and links', () => {
    const para = parseMarkdown('**b** *i* ~~s~~ `c` [t](https://x.jp)')
      .content?.[0];
    const marks = para?.content?.flatMap(
      (t) => t.marks?.map((m) => m.type) ?? [],
    );
    expect(marks).toEqual(
      expect.arrayContaining(['bold', 'italic', 'strike', 'code', 'link']),
    );
  });

  it('turns $$ blocks into mathBlock nodes', () => {
    const doc = parseMarkdown('$$\n\\int_0^1 x dx\n$$');
    expect(doc.content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: '\\int_0^1 x dx' },
    });
  });

  it('keeps inline math as plain text', () => {
    const para = parseMarkdown('when $E=mc^2$ holds').content?.[0];
    expect(para?.content?.map((t) => t.text).join('')).toBe(
      'when $E=mc^2$ holds',
    );
  });

  it('preserves tables as rawBlock verbatim', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const doc = parseMarkdown(src);
    expect(doc.content?.[0]?.type).toBe('rawBlock');
    expect(doc.content?.[0]?.attrs?.content).toBe(src);
  });

  it('preserves html blocks as rawBlock verbatim', () => {
    const doc = parseMarkdown('<div class="x">\nhi\n</div>');
    expect(doc.content?.[0]?.type).toBe('rawBlock');
  });

  it('extracts frontmatter into a frontmatter node at doc head', () => {
    const doc = parseMarkdown('---\ntitle: hi\n---\n\n# body');
    expect(doc.content?.[0]).toMatchObject({
      type: 'frontmatter',
      attrs: { content: 'title: hi' },
    });
    expect(doc.content?.[1]?.type).toBe('heading');
  });
});

describe('parseMarkdown (review fixes: images/html_inline, container-nested raw blocks, reference definitions)', () => {
  it('keeps a document with an inline image intact instead of collapsing to one rawBlock', () => {
    const doc = parseMarkdown('# Title\n\n![alt](a.png)\n\nbody');
    expect(doc.content?.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
    ]);
    const imagePara = doc.content?.[1];
    expect(imagePara?.content?.map((t) => t.text).join('')).toBe(
      '![alt](a.png)',
    );
  });

  it('keeps inline html as plain text instead of collapsing the paragraph', () => {
    const doc = parseMarkdown('text with <br> more');
    expect(doc.content?.[0]?.type).toBe('paragraph');
    expect(doc.content?.[0]?.content?.map((t) => t.text).join('')).toBe(
      'text with <br> more',
    );
  });

  it('does not leak the blockquote marker into a nested table rawBlock', () => {
    const doc = parseMarkdown('> | a | b |\n> | --- | --- |\n> | 1 | 2 |');
    const quote = doc.content?.[0];
    expect(quote?.type).toBe('blockquote');
    const raw = quote?.content?.[0];
    expect(raw?.type).toBe('rawBlock');
    expect(raw?.attrs?.content).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('preserves a used link reference definition verbatim instead of dropping it', () => {
    const src = '[foo]: https://example.com "bar"\n\nsee [foo][foo]';
    const doc = parseMarkdown(src);
    expect(doc.content?.[0]).toMatchObject({
      type: 'rawBlock',
      attrs: { content: '[foo]: https://example.com "bar"' },
    });
  });

  it('preserves an unused link reference definition verbatim', () => {
    const doc = parseMarkdown('[foo]: https://example.com');
    expect(doc.content?.[0]).toMatchObject({
      type: 'rawBlock',
      attrs: { content: '[foo]: https://example.com' },
    });
  });
});

describe('splitFrontmatter', () => {
  it('splits only a leading --- block', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({
      frontmatter: 'a: 1',
      body: 'body',
    });
    expect(splitFrontmatter('body\n---\nx\n---')).toEqual({
      frontmatter: null,
      body: 'body\n---\nx\n---',
    });
  });
});
