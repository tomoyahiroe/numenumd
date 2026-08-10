// @vitest-environment jsdom

import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
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

/**
 * jsdom は `ClipboardEvent` / `DataTransfer` を持たないが、`view.pasteHTML` は
 * それらを使う。**本物のペースト経路**(`parseFromClipboard`)を通すことが
 * このマトリクスの要点なので、`parseSlice` で代用せず最小限を用意する。
 */
class FakeDataTransfer {
  private data: Record<string, string> = {};
  types: string[] = [];
  setData(type: string, value: string) {
    this.data[type] = value;
    this.types = Object.keys(this.data);
  }
  getData(type: string) {
    return this.data[type] ?? '';
  }
  get files() {
    return [] as unknown as FileList;
  }
}
class FakeClipboardEvent extends Event {
  clipboardData: FakeDataTransfer;
  constructor(type: string, init?: { clipboardData?: FakeDataTransfer }) {
    super(type, { bubbles: true, cancelable: true });
    this.clipboardData = init?.clipboardData ?? new FakeDataTransfer();
  }
}
beforeAll(() => {
  vi.stubGlobal('ClipboardEvent', FakeClipboardEvent);
  vi.stubGlobal('DataTransfer', FakeDataTransfer);
});
afterAll(() => vi.unstubAllGlobals());

// 独立レビュー Blocker 1: `transformPasted` が `table` ノードしか見ていな
// かったため、クリップボード HTML が表の内部タグで始まる形(ウェブページの
// 表を部分選択してコピーすると普通に起きる)では結合セルが素通しし、貼った
// 文書が保存不能になったままだった。
//
// 「経路は2つ、両方塞いだ」というコメントでの宣言は3周連続で数え漏れを
// 起こしたので、宣言する代わりに**経路そのものをマトリクスとして固定する**。
// 新しい経路が増えたらここに足す。
describe('paste paths that can carry merged cells', () => {
  const CASES: Array<[string, string]> = [
    ['<table> wrapper', '<table><tr><td colspan="2">x</td></tr></table>'],
    ['bare <tr>, single row', '<tr><td colspan="2">x</td></tr>'],
    ['<thead> only', '<thead><tr><th colspan="2">h</th></tr></thead>'],
    ['<tbody> only', '<tbody><tr><td colspan="2">x</td></tr></tbody>'],
    ['single <td>', '<td colspan="2">a</td>'],
    ['single <th>', '<th colspan="3">a</th>'],
    [
      'meta prefix + bare <tr>',
      '<meta charset=\'utf-8\'><tr><td colspan="2">x</td></tr>',
    ],
    [
      'bare <tr>, two rows',
      '<tr><td colspan="2">x</td></tr><tr><td>y</td></tr>',
    ],
  ];

  for (const [label, html] of CASES) {
    it(`leaves the document savable after pasting ${label}`, () => {
      const editor = makeEditor();
      editor.view.pasteHTML(html);
      expect(() => serializeMarkdown(editor.getJSON())).not.toThrow();
    });
  }

  // レビュー指摘: `tableRow` 分岐を消しても全テストが通っていた。上のケースは
  // どれも空ドキュメントへの貼り付けで、`tableRow` は汎用再帰へ落ちて子の
  // `tableCell` 分岐が結局正規化するため。`tableRow` 分岐が本当に効くのは
  // **既存の表の中に行を貼る**とき ─ ウェブの表から行をコピーして自分の表に
  // 貼る、という普通の操作がそれに当たる。
  it('leaves the document savable when a row is pasted inside an existing table', () => {
    const editor = makeEditor();
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setTextSelection(4); // 先頭セルの中
    editor.view.pasteHTML('<tr><td colspan="3">merged</td></tr>');

    expect(() => serializeMarkdown(editor.getJSON())).not.toThrow();
    expect(serializeMarkdown(editor.getJSON())).toContain('merged');
  });

  it('keeps the pasted content through every one of those paths', () => {
    for (const [label, html] of CASES) {
      const editor = makeEditor();
      editor.view.pasteHTML(html);
      const out = serializeMarkdown(editor.getJSON());
      // 内容(x / h / a / y)のいずれかは必ず残る。
      expect(out, label).toMatch(/[xhay]/);
    }
  });
});

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

  // 独立レビュー(3周目)Blocker: 「1行あたりの上限」として実装した cap が、
  // 上限を超えた分の**実セル**まで捨てていた。70セル貼ると64セルしか残らず、
  // 100列の表を全選択コピーして貼り直すだけで35列が消える ─ 第一原則
  // (ユーザーの Markdown を絶対に失わない)への正面違反であり、main には
  // 無かった退行だった。列数の上限は撤回し、抑えるのは空セルの生成だけにした。
  it('keeps every real cell when a row is wider than the colspan cap', () => {
    const editor = makeEditor();
    const tds = Array.from({ length: 70 }, (_, i) => `<td>c${i}</td>`).join('');
    const doc = pasteHtml(editor, `<table><tr>${tds}</tr></table>`);

    const rows = cells(doc);
    expect(rows?.[0]).toHaveLength(70);
    expect(rows?.[0]?.map((c) => c?.text)).toEqual(
      Array.from({ length: 70 }, (_, i) => `c${i}`),
    );
    // シリアライズしても最後のセルまで残る。
    expect(serializeMarkdown(doc)).toContain('c69');
  });

  it('survives a copy/paste round trip of a 100-column table', () => {
    const editor = makeEditor();
    const headers = Array.from({ length: 100 }, (_, i) => `<th>h${i}</th>`);
    const bodies = Array.from({ length: 100 }, (_, i) => `<td>c${i}</td>`);
    const doc = pasteHtml(
      editor,
      `<table><tr>${headers.join('')}</tr><tr>${bodies.join('')}</tr></table>`,
    );

    const out = serializeMarkdown(doc);
    expect(out).toContain('h99');
    expect(out).toContain('c99');
  });

  // 空セルの生成だけは抑える。`colspan="200000"` をそのまま実体化すると
  // 20万個の空セルでタブが固まる。内容を持つセルは常に1個出るので、この
  // クランプで情報は落ちない。
  it('clamps colspan expansion without losing the cell content', () => {
    const editor = makeEditor();
    const doc = pasteHtml(
      editor,
      '<table><tr><td colspan="5000">x</td><td>tail</td></tr><tr><td>a</td></tr></table>',
    );

    const rows = cells(doc);
    // 5000 ではなく 64 + 1(tail)で頭打ち。
    expect(rows?.[0]?.length).toBeLessThanOrEqual(70);
    // 内容を持つセルは両方とも残る。
    const texts = rows?.[0]?.map((c) => c?.text) ?? [];
    expect(texts).toContain('x');
    expect(texts).toContain('tail');
    expect(rows?.[1]?.map((c) => c?.text)).toContain('a');
    // 全行が同じ幅に揃う。
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
