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

  it('parses a table into editable table nodes', () => {
    const doc = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const table = doc.content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content?.map((row) => row.type)).toEqual([
      'tableRow',
      'tableRow',
    ]);
    const [header, body] = table?.content ?? [];
    expect(header?.content?.map((c) => c.type)).toEqual([
      'tableHeader',
      'tableHeader',
    ]);
    expect(body?.content?.map((c) => c.type)).toEqual([
      'tableCell',
      'tableCell',
    ]);
  });

  // セルの content は `paragraph` に制限してある(GFM のセルにはインラインしか
  // 書けないため)。段落で包み損ねると createAndFill が null を返してセルが
  // 黙って消えるので、構造そのものを固定する。
  it('wraps cell content in a paragraph so cells are not silently dropped', () => {
    const doc = parseMarkdown('| a |\n| --- |\n| 1 |');
    const cell = doc.content?.[0]?.content?.[1]?.content?.[0];
    expect(cell?.type).toBe('tableCell');
    expect(cell?.content?.[0]?.type).toBe('paragraph');
    expect(cell?.content?.[0]?.content?.[0]?.text).toBe('1');
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

  it('parses a table nested in a blockquote', () => {
    const doc = parseMarkdown('> | a | b |\n> | --- | --- |\n> | 1 | 2 |');
    const quote = doc.content?.[0];
    expect(quote?.type).toBe('blockquote');
    expect(quote?.content?.[0]?.type).toBe('table');
  });

  it('does not leak the blockquote marker into a nested table rawBlock', () => {
    // 超過セルを持つ表は rawBlock 据え置き。その verbatim テキストに `> ` が
    // 混入しないこと(行のスライスがコンテナを考慮していること)を固定する。
    const doc = parseMarkdown('> | a | b |\n> | --- | --- |\n> | 1 | 2 | 3 |');
    const quote = doc.content?.[0];
    expect(quote?.type).toBe('blockquote');
    const raw = quote?.content?.[0];
    expect(raw?.type).toBe('rawBlock');
    expect(raw?.attrs?.content).toBe('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |');
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

// 表の対応方針(spec「テーブル(GFM パイプテーブル)」節)は、
// 「情報が落ちるかどうか」だけを線引きにしたハイブリッド。
// GFM はヘッダ列数を超えたセルを黙って捨てるため、そういう表だけは
// 従来どおり rawBlock で verbatim 保全する。
describe('parseMarkdown (tables: 変換するか rawBlock 据え置きかの線引き)', () => {
  const cellTexts = (doc: ReturnType<typeof parseMarkdown>) =>
    doc.content?.[0]?.content?.map((row) =>
      row.content?.map(
        (cell) =>
          cell.content?.[0]?.content?.map((t) => t.text ?? '').join('') ?? '',
      ),
    );

  it('keeps a table whose row has more cells than the header as a verbatim rawBlock', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |';
    const doc = parseMarkdown(src);
    expect(doc.content?.[0]?.type).toBe('rawBlock');
    // 原文が1バイトも変わらないこと。`3` を落として table 化してはいけない。
    expect(doc.content?.[0]?.attrs?.content).toBe(src);
  });

  it('still converts a table whose row has fewer cells (padding loses nothing)', () => {
    const doc = parseMarkdown('| a | b |\n| --- | --- |\n| 1 |');
    expect(doc.content?.[0]?.type).toBe('table');
    expect(cellTexts(doc)).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('detects the excess cell even when it is on a later row', () => {
    const doc = parseMarkdown(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 | 7 |',
    );
    expect(doc.content?.[0]?.type).toBe('rawBlock');
  });

  it('does not count an escaped pipe as a cell boundary', () => {
    // `1 \| 2 | 3` は2セル。エスケープを見落とすと3セル = 超過と誤判定し、
    // 編集できるはずの表が rawBlock に落ちてしまう。
    const doc = parseMarkdown('| a | b |\n| --- | --- |\n| 1 \\| 2 | 3 |');
    expect(doc.content?.[0]?.type).toBe('table');
    expect(cellTexts(doc)?.[1]).toEqual(['1 | 2', '3']);
  });

  it('keeps column alignment from the delimiter row', () => {
    const doc = parseMarkdown(
      '| l | c | r | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |',
    );
    const alignments = doc.content?.[0]?.content?.map((row) =>
      row.content?.map((cell) => cell.attrs?.alignment ?? null),
    );
    expect(alignments).toEqual([
      ['left', 'center', 'right', null],
      ['left', 'center', 'right', null],
    ]);
  });

  it('keeps inline marks, math and images inside cells', () => {
    const doc = parseMarkdown(
      '| a | b | c |\n| --- | --- | --- |\n| **x** | $y_1$ | ![i](p.png) |',
    );
    const row = doc.content?.[0]?.content?.[1];
    const bold = row?.content?.[0]?.content?.[0]?.content?.[0];
    expect(bold?.text).toBe('x');
    expect(bold?.marks?.[0]?.type).toBe('bold');
    expect(cellTexts(doc)?.[1]).toEqual(['x', '$y_1$', '![i](p.png)']);
  });

  it('leaves an html table as a rawBlock', () => {
    const doc = parseMarkdown('<table>\n<tr><td>a</td></tr>\n</table>');
    expect(doc.content?.[0]?.type).toBe('rawBlock');
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
