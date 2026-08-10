// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from './Editor';
import { KeyRouter } from '../keymap/router';

afterEach(() => {
  cleanup();
  delete window.__numenumdEditor__;
});

async function mountWith(
  doc: Parameters<typeof MarkdownEditor>[0]['initialDoc'],
) {
  const onDocChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      initialDoc={doc}
      router={new KeyRouter()}
      onDocChange={onDocChange}
    />,
  );
  await vi.waitFor(() => {
    expect(window.__numenumdEditor__).toBeTruthy();
  });
  return { ...utils, onDocChange };
}

describe('mathBlock NodeView', () => {
  it('renders KaTeX and switches to a textarea on click, committing on blur', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }],
    });

    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    expect(mathDom!.querySelector('.katex')).toBeTruthy();

    act(() => {
      fireEvent.click(mathDom!);
    });
    const textarea = mathDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe('E = mc^2');

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'a^2 + b^2 = c^2' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.latex,
    ).toBe('a^2 + b^2 = c^2');
    // should have switched back to display mode
    expect(mathDom!.querySelector('textarea')).toBeNull();
    expect(mathDom!.querySelector('.katex')).toBeTruthy();
  });
});

describe('rawBlock NodeView', () => {
  it('shows content in a <pre> and edits via textarea on click', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'rawBlock', attrs: { content: '| a | b |\n|---|---|' } },
      ],
    });

    const rawDom = container.querySelector('[data-raw-block]');
    expect(rawDom!.querySelector('pre.numenumd-raw')?.textContent).toBe(
      '| a | b |\n|---|---|',
    );

    act(() => {
      fireEvent.click(rawDom!);
    });
    const textarea = rawDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'new raw content' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.content,
    ).toBe('new raw content');
  });
});

describe('frontmatter NodeView', () => {
  it('renders a details/summary and edits the inner pre via textarea', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'frontmatter', attrs: { content: 'title: Hello' } }],
    });

    const fmDom = container.querySelector('[data-frontmatter]');
    const details = fmDom!.querySelector('details.numenumd-frontmatter');
    expect(details).toBeTruthy();
    expect(details!.querySelector('summary')?.textContent).toBe('Front matter');
    expect(details!.querySelector('pre')?.textContent).toBe('title: Hello');

    act(() => {
      fireEvent.click(details!.querySelector('pre')!);
    });
    const textarea = fmDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'title: World' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.content,
    ).toBe('title: World');
  });
});

describe('mathBlock creation focus (UX feedback)', () => {
  it('opens a newly created math block in edit mode with the textarea focused', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '$$' }] }],
    });
    const editor = window.__numenumdEditor__!;

    act(() => {
      editor.commands.setTextSelection(3); // after "$$"
      editor.commands.keyboardShortcut('Enter');
    });

    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    const textarea = mathDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('does not steal focus for an empty math block that exists at load time', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: '' } }],
    });
    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    expect(mathDom!.querySelector('textarea')).toBeNull();
  });
});

describe('mathBlock exit keys (UX feedback)', () => {
  const editAndPress = async (
    key: string,
    init: Partial<KeyboardEventInit>,
  ) => {
    const utils = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'x' } }],
    });
    const mathDom = utils.container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'x + y' } });
      fireEvent.keyDown(textarea, { key, ...init });
    });
    return { ...utils, mathDom };
  };

  it('Escape commits, closes the editor, and moves the cursor to a paragraph after the block', async () => {
    const { mathDom } = await editAndPress('Escape', {});
    const editor = window.__numenumdEditor__!;

    expect(mathDom.querySelector('textarea')).toBeNull();
    const json = editor.getJSON();
    expect(json.content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'x + y' },
    });
    // a paragraph is created after the block and the selection lands inside it
    expect(json.content?.[1]?.type).toBe('paragraph');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('Cmd+Enter commits and moves the cursor to the following paragraph', async () => {
    const { mathDom } = await editAndPress('Enter', { metaKey: true });
    const editor = window.__numenumdEditor__!;

    expect(mathDom.querySelector('textarea')).toBeNull();
    expect(editor.getJSON().content?.[1]?.type).toBe('paragraph');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('reuses an existing following paragraph instead of inserting a new one', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'a' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    const editor = window.__numenumdEditor__!;
    expect(editor.getJSON().content).toHaveLength(2);
    expect(editor.state.selection.$from.parent.textContent).toBe('tail');
  });
});

describe('mathBlock re-exit with unchanged content (bug report)', () => {
  it('closes the editor on Cmd+Enter even when the latex was not changed', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
        { type: 'paragraph' },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      // 値を変更せずにそのまま確定
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    });

    expect(mathDom.querySelector('textarea')).toBeNull();
    expect(mathDom.querySelector('.katex')).toBeTruthy();
    const editor = window.__numenumdEditor__!;
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('closes the editor on Escape when the latex was not changed', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'x' } }],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    act(() => {
      fireEvent.keyDown(mathDom.querySelector('textarea')!, {
        key: 'Escape',
      });
    });
    expect(mathDom.querySelector('textarea')).toBeNull();
  });

  it('supports repeated open -> exit cycles without stacking click handlers', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'a' } },
        { type: 'paragraph' },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;

    for (let i = 0; i < 3; i++) {
      act(() => {
        fireEvent.click(mathDom);
      });
      expect(mathDom.querySelectorAll('textarea')).toHaveLength(1);
      act(() => {
        fireEvent.keyDown(mathDom.querySelector('textarea')!, {
          key: 'Escape',
        });
      });
      expect(mathDom.querySelector('textarea')).toBeNull();
    }
  });
});

describe('mathBlock katex rendering across repeated exits (bug report)', () => {
  it('keeps katex rendering after two edit -> Cmd+Enter cycles with changed content', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'a' } },
        { type: 'paragraph' },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;

    for (const [cycle, val] of [
      ['1st', 'a + b'],
      ['2nd', 'a + b + c'],
    ] as const) {
      act(() => {
        fireEvent.click(mathDom);
      });
      const ta = mathDom.querySelector('textarea');
      expect(ta, `${cycle}: textarea opens`).toBeTruthy();
      act(() => {
        fireEvent.change(ta!, { target: { value: val } });
        fireEvent.keyDown(ta!, { key: 'Enter', metaKey: true });
      });
      expect(
        mathDom.querySelector('textarea'),
        `${cycle}: editor closes`,
      ).toBeNull();
      expect(
        mathDom.querySelector('.katex'),
        `${cycle}: katex is rendered`,
      ).toBeTruthy();
      expect(mathDom.textContent, `${cycle}: shows current formula`).toContain(
        val.replace(/ /g, ''),
      );
    }

    const editor = window.__numenumdEditor__!;
    expect(editor.getJSON().content?.[0]?.attrs?.latex).toBe('a + b + c');
  });
});

// 表の編集 UI(spec「テーブル(GFM パイプテーブル)」節)。
// jsdom では要素の実寸(offsetWidth 等)が取れないため、グリップの座標合わせは
// 検証できない。ここでは「UI が存在すること」と「操作が正しいコマンドに
// 繋がっていること」を DOM 経由で固定する。
describe('table NodeView', () => {
  const tableDoc = (rows: string[][]) => ({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: rows.map((cells, rowIndex) => ({
          type: 'tableRow',
          content: cells.map((text) => ({
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          })),
        })),
      },
    ],
  });

  const size = () => {
    const table = window.__numenumdEditor__!.getJSON().content?.[0];
    return {
      rows: table?.content?.length ?? 0,
      cols: table?.content?.[0]?.content?.length ?? 0,
    };
  };

  it('renders one grip per column and per row', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]),
    );
    expect(
      container.querySelectorAll(
        '.numenumd-table-grips-col .numenumd-table-grip',
      ),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        '.numenumd-table-grips-row .numenumd-table-grip',
      ),
    ).toHaveLength(2);
  });

  it('adds a column with the right-edge + button', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
      ]),
    );
    expect(size()).toEqual({ rows: 2, cols: 2 });

    act(() => {
      fireEvent.mouseDown(container.querySelector('.numenumd-table-add-col')!);
    });
    expect(size()).toEqual({ rows: 2, cols: 3 });
  });

  it('adds a row with the bottom-edge + button', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
      ]),
    );

    act(() => {
      fireEvent.mouseDown(container.querySelector('.numenumd-table-add-row')!);
    });
    expect(size()).toEqual({ rows: 3, cols: 2 });
  });

  it('selects a whole column when its grip is clicked, and Backspace deletes it', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]),
    );
    const editor = window.__numenumdEditor__!;

    act(() => {
      fireEvent.mouseDown(
        container.querySelectorAll(
          '.numenumd-table-grips-col .numenumd-table-grip',
        )[1]!,
      );
    });
    // 列全体が選択されている(= 行選択ではない)。
    const selection = editor.state.selection as unknown as {
      isColSelection?: () => boolean;
    };
    expect(selection.isColSelection?.()).toBe(true);

    act(() => {
      editor.commands.keyboardShortcut('Backspace');
    });
    expect(size()).toEqual({ rows: 2, cols: 2 });
    const headers = editor
      .getJSON()
      .content?.[0]?.content?.[0]?.content?.map(
        (cell) => cell.content?.[0]?.content?.[0]?.text,
      );
    expect(headers).toEqual(['a', 'c']);
  });

  it('selects a whole row when its grip is clicked, and Backspace deletes it', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ]),
    );
    const editor = window.__numenumdEditor__!;

    act(() => {
      fireEvent.mouseDown(
        container.querySelectorAll(
          '.numenumd-table-grips-row .numenumd-table-grip',
        )[1]!,
      );
    });
    const selection = editor.state.selection as unknown as {
      isRowSelection?: () => boolean;
    };
    expect(selection.isRowSelection?.()).toBe(true);

    act(() => {
      editor.commands.keyboardShortcut('Backspace');
    });
    expect(size()).toEqual({ rows: 2, cols: 2 });
  });

  // 独立レビュー F6: `layoutGrips()` の呼び元は init と `update()` だけで、
  // それを守るテストが無く、`table.style.minWidth` の行も含めて消しても
  // 全テストが通っていた。jsdom はピクセルを測れないものの、グリップの
  // 「個数」と minWidth の「計算値」は観測できる。
  it('keeps grips and the min-width in step with the column/row count', async () => {
    const { container } = await mountWith(
      tableDoc([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]),
    );
    const editor = window.__numenumdEditor__!;
    const table = container.querySelector('table')!;
    const colGrips = () =>
      container.querySelectorAll(
        '.numenumd-table-grips-col .numenumd-table-grip',
      ).length;
    const rowGrips = () =>
      container.querySelectorAll(
        '.numenumd-table-grips-row .numenumd-table-grip',
      ).length;

    expect(colGrips()).toBe(3);
    expect(rowGrips()).toBe(2);
    const initialMinWidth = table.style.minWidth;
    expect(initialMinWidth).not.toBe('');

    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.deleteColumn();
    });
    expect(colGrips()).toBe(2);
    // 列が減れば下限幅も比例して縮む。
    expect(parseInt(table.style.minWidth, 10)).toBe(
      (parseInt(initialMinWidth, 10) / 3) * 2,
    );

    act(() => {
      editor.commands.deleteRow();
    });
    expect(rowGrips()).toBe(1);
  });

  // 独立レビュー M1: `ResizeObserver` はテストが1本も無く、ブロックごと消しても
  // 全テストが通っていた。jsdom は `ResizeObserver` を持たないので実装側は
  // 常に null になる ─ スタブを注入して配線だけを固定する。
  it('observes the scroll container for resizes and disconnects on destroy', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    class StubResizeObserver {
      constructor(public cb: () => void) {}
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    try {
      const { container, unmount } = await mountWith(
        tableDoc([
          ['a', 'b'],
          ['1', '2'],
        ]),
      );
      const scroll = container.querySelector('.numenumd-table-scroll');
      expect(observe).toHaveBeenCalledWith(scroll);

      // マウント中に NodeView が作り直されることがあるので、絶対回数ではなく
      // 「unmount で必ず1つ増える」ことを見る。
      const before = disconnect.mock.calls.length;
      unmount();
      expect(disconnect.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks the wrapper active only while the cursor sits inside the table', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        ...(tableDoc([
          ['a', 'b'],
          ['1', '2'],
        ]).content ?? []),
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    });
    const editor = window.__numenumdEditor__!;
    const wrap = container.querySelector('.numenumd-table-wrap')!;

    act(() => {
      editor.commands.setTextSelection(3); // 表の最初のセルの中
    });
    expect(wrap.classList.contains('is-active')).toBe(true);

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    expect(wrap.classList.contains('is-active')).toBe(false);
  });

  // README・store-listing・spec・smoke 7-5 が「Tab でセル移動、最終セルの Tab で
  // 行追加」を約束している。実体は tiptap Table 拡張の既定キーマップなので、
  // 拡張の更新や priority 1000 の自前キーマップに Tab が増えたときに無音で
  // 壊れうる。約束している以上ここで固定する。
  //
  // `editor.commands.keyboardShortcut('Tab')` は使えない。tiptap のこの
  // コマンドは捕捉したトランザクションの **step だけ** を再生するため、
  // 選択しか動かさない `goToNextCell` は何も起きないまま `true` を返す。
  // 実際の keydown をビューへ流す。
  const pressTab = (editor: NonNullable<typeof window.__numenumdEditor__>) => {
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    });
  };

  it('moves to the next cell with Tab', async () => {
    await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
      ]),
    );
    const editor = window.__numenumdEditor__!;
    act(() => {
      editor.commands.setTextSelection(4); // 先頭セルのテキスト内
    });
    const before = editor.state.selection.from;
    pressTab(editor);
    expect(editor.state.selection.from).toBeGreaterThan(before);
    expect(size()).toEqual({ rows: 2, cols: 2 }); // まだ行は増えない
  });

  it('adds a row when Tab is pressed in the last cell', async () => {
    await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
      ]),
    );
    const editor = window.__numenumdEditor__!;
    act(() => {
      editor.commands.setTextSelection(4);
    });
    // 2x2 なので3回で最終セルに着く。
    pressTab(editor);
    pressTab(editor);
    pressTab(editor);
    expect(size()).toEqual({ rows: 2, cols: 2 });
    pressTab(editor);
    expect(size()).toEqual({ rows: 3, cols: 2 });
  });

  // GFM のセルは改行を表現できない。Shift+Enter が通ると `\` が書き出されて
  // 表が壊れるので、セル内では無効化する。
  it('does not insert a hard break inside a cell', async () => {
    await mountWith(
      tableDoc([
        ['a', 'b'],
        ['1', '2'],
      ]),
    );
    const editor = window.__numenumdEditor__!;

    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.keyboardShortcut('Shift-Enter');
    });

    const cell = editor.getJSON().content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.content?.[0]?.content?.map((n) => n.type)).toEqual(['text']);
  });
});
