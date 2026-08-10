// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { buildExtensions } from '../extensions';
import { serializeMarkdown } from '../../markdown/serialize';

const editors: Editor[] = [];
const makeEditor = () => {
  const editor = new Editor({ extensions: buildExtensions() });
  editors.push(editor);
  return editor;
};

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

/** 実際の貼り付けと同じ経路: HTML → parseSlice → transformPasted。 */
function pasteHtml(editor: Editor, html: string) {
  const dom = new globalThis.DOMParser().parseFromString(html, 'text/html');
  const parsed = PMDOMParser.fromSchema(editor.schema).parseSlice(dom.body);
  const transformed =
    editor.view.someProp('transformPasted', (f) =>
      f(parsed, editor.view, false),
    ) ?? parsed;
  editor.view.dispatch(editor.view.state.tr.replaceSelection(transformed));
  return editor.getJSON();
}

const cells = (doc: ReturnType<Editor['getJSON']>) =>
  doc.content
    ?.find((n) => n.type === 'table')
    ?.content?.map((row) =>
      row.content?.map((cell) => ({
        colspan: cell.attrs?.colspan,
        rowspan: cell.attrs?.rowspan,
        text:
          cell.content?.[0]?.content?.map((t) => t.text ?? '').join('') ?? '',
      })),
    );

// 独立レビューの指摘(高): tiptap の TableCell/TableHeader は parseHTML で
// colspan/rowspan を読むため、ウェブページの結合セル入り表を貼るとそのまま
// doc に入り、serializeMarkdown が例外を投げて**文書全体が保存不能**になる。
// 「UI から結合を作れないので到達しない」という当初の想定は誤りだった。
describe('pasting a table with merged cells', () => {
  it('splits colspan into separate cells and keeps the content', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><th colspan="2">wide</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(cells(doc)).toEqual([
      [
        { colspan: 1, rowspan: 1, text: 'wide' },
        { colspan: 1, rowspan: 1, text: '' },
      ],
      [
        { colspan: 1, rowspan: 1, text: '1' },
        { colspan: 1, rowspan: 1, text: '2' },
      ],
    ]);
  });

  it('drops rowspan and keeps every row rectangular', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><td rowspan="2">merged</td><td>x</td></tr><tr><td>y</td></tr></table>',
    );
    const rows = cells(doc);
    expect(rows?.every((row) => row?.length === rows[0]?.length)).toBe(true);
    expect(
      rows?.flat().every((c) => c?.colspan === 1 && c?.rowspan === 1),
    ).toBe(true);
    // 内容は失われない。
    expect(rows?.flat().map((c) => c?.text)).toContain('merged');
    expect(rows?.flat().map((c) => c?.text)).toContain('x');
    expect(rows?.flat().map((c) => c?.text)).toContain('y');
  });

  it('leaves the document savable (this is the actual regression)', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><th colspan="3">a</th></tr><tr><td rowspan="2">b</td><td>c</td><td>d</td></tr></table>',
    );
    expect(() => serializeMarkdown(doc)).not.toThrow();
    expect(serializeMarkdown(doc)).toContain('|');
  });

  it('turns a <br> inside a cell into a space rather than a stray backslash', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><th>h</th></tr><tr><td>a<br>b</td></tr></table>',
    );
    const out = serializeMarkdown(doc);
    expect(out).toContain('| a b |');
    expect(out).not.toContain('\\');
  });

  // 独立レビュー F1: tiptap は colspan を parseInt するだけでクランプしない。
  // 属性を残す(= 保存時に例外)方式から、セルを実体化する方式に変えた以上、
  // 上限はこちら側で持つ必要がある。クランプが無いと
  // `colspan="200000"` で40万セルを生成してタブが固まる(実測)。
  //
  // テストで使う値を 200000 ではなく 200 にしているのは、失敗の仕方の問題。
  // 200000 のままだとクランプを外したときテストが「落ちる」のではなく
  // 「返ってこなくなる」(実際にこの検証中、ジョブがタイムアウトするまで
  // 戻らなかった)。CI ではそれが最も分かりにくい壊れ方になる。
  // 200 ならクランプの有無にかかわらず一瞬で終わり、外したときは
  // `expected 200 to be less than or equal to 64` と明示的に落ちる。
  it('clamps an absurd colspan instead of materialising the cells', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><td colspan="200">x</td></tr><tr><td>a</td></tr></table>',
    );
    const rows = cells(doc);
    expect(rows?.[0]?.length).toBeLessThanOrEqual(64);
    // 内容は先頭セルに残る(クランプは情報を落とさない)。
    expect(rows?.[0]?.[0]?.text).toBe('x');
    expect(rows?.[1]?.[0]?.text).toBe('a');
    // 全ての行が同じ幅に揃っていること。
    expect(rows?.every((row) => row?.length === rows[0]?.length)).toBe(true);
  });

  // 独立レビュー F3: `<br>` の修正はペースト側と書き出し側の二重で守られて
  // いるため、既存のテストはどちらか片方を消しても通ってしまっていた。
  // 両側を個別に固定する。
  it('removes the hardBreak from the document at paste time', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><th>h</th></tr><tr><td>a<br>b</td></tr></table>',
    );
    const types: string[] = [];
    const walk = (nodes: NonNullable<typeof doc.content>) => {
      for (const n of nodes) {
        types.push(n.type ?? '');
        if (n.content) walk(n.content);
      }
    };
    walk(doc.content ?? []);
    expect(types).not.toContain('hardBreak');
  });

  it('folds a hardBreak that reached a cell without going through paste', () => {
    const editor = makeEditor();
    // ペーストを経由せずセルに hardBreak を入れる(書き出し側の防御だけを見る)。
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'h' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'a' },
                        { type: 'hardBreak' },
                        { type: 'text', text: 'b' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const out = serializeMarkdown(editor.getJSON());
    expect(out).toContain('| a b |');
    expect(out).not.toContain('\\');
  });

  it('does not disturb a plain table without merged cells', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    // 貼り付け先の空段落が先頭に残るので、表の部分だけを比べる。
    expect(serializeMarkdown(doc).trim()).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
    );
  });
});
