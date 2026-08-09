import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { CellSelection, TableMap } from 'prosemirror-tables';

/**
 * 表の編集 UI(NodeView)。
 *
 * spec の「テーブル(GFM パイプテーブル)」節で決めた形:
 * - 表にカーソルがある間だけ、右端と下端に列/行を足す `+` ボタンを出す。
 * - 上端に列グリップ帯、左端に行グリップ帯を出す。クリックでその列/行を
 *   `CellSelection` で選択し、そのまま Backspace で削除できる
 *   (削除側のキーハンドラは `./table.ts` の `TableCellKeymap`)。
 *
 * グリップ帯は表のセルと桁を合わせる必要があるが、`<table>` の内側に置くと
 * ProseMirror の管理下(= ドキュメントの内容)に入ってしまう。そのため
 * contentDOM の外に絶対配置し、実際のセルの座標を測って位置を合わせる。
 */
function measurable(el: HTMLElement): { offset: number; size: number } {
  // jsdom では offsetLeft / offsetWidth が常に 0 になる。座標合わせは
  // 表示上の都合でしかないので、測れない環境では 0 のまま置く(グリップ自体は
  // DOM に存在し、クリックできる = テストで挙動を検証できる)。
  return { offset: el.offsetLeft, size: el.offsetWidth };
}

export const tableNodeView: NodeViewRenderer = ({ editor, node, getPos }) => {
  let currentNode = node as PMNode;

  const dom = document.createElement('div');
  dom.className = 'numenumd-table-wrap';

  const scroll = document.createElement('div');
  scroll.className = 'numenumd-table-scroll';
  dom.appendChild(scroll);

  const colGrips = document.createElement('div');
  colGrips.className = 'numenumd-table-grips numenumd-table-grips-col';
  colGrips.contentEditable = 'false';
  scroll.appendChild(colGrips);

  const rowGrips = document.createElement('div');
  rowGrips.className = 'numenumd-table-grips numenumd-table-grips-row';
  rowGrips.contentEditable = 'false';
  scroll.appendChild(rowGrips);

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);

  const addColumn = document.createElement('button');
  addColumn.type = 'button';
  addColumn.className = 'numenumd-table-add numenumd-table-add-col';
  addColumn.setAttribute('aria-label', 'Add column');
  addColumn.textContent = '+';
  addColumn.contentEditable = 'false';
  dom.appendChild(addColumn);

  const addRow = document.createElement('button');
  addRow.type = 'button';
  addRow.className = 'numenumd-table-add numenumd-table-add-row';
  addRow.setAttribute('aria-label', 'Add row');
  addRow.textContent = '+';
  addRow.contentEditable = 'false';
  dom.appendChild(addRow);

  const tablePos = (): number | null => {
    if (typeof getPos !== 'function') return null;
    const pos = getPos();
    return typeof pos === 'number' ? pos : null;
  };

  /** `(row, col)` のセルの直前を指す ResolvedPos。 */
  const resolveCell = (row: number, col: number) => {
    const pos = tablePos();
    if (pos === null) return null;
    const map = TableMap.get(currentNode);
    if (row >= map.height || col >= map.width) return null;
    const cellPos = pos + 1 + map.positionAt(row, col, currentNode);
    return editor.state.doc.resolve(cellPos);
  };

  /** そのセルの中へカーソルを移してから table コマンドを撃つ。 */
  const withCursorInCell = (row: number, col: number, run: () => void) => {
    const $cell = resolveCell(row, col);
    if (!$cell) return;
    const { view } = editor;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve($cell.pos + 1)),
      ),
    );
    run();
  };

  addColumn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const map = TableMap.get(currentNode);
    withCursorInCell(0, map.width - 1, () => editor.commands.addColumnAfter());
  });

  addRow.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const map = TableMap.get(currentNode);
    withCursorInCell(map.height - 1, 0, () => editor.commands.addRowAfter());
  });

  const selectColumn = (col: number) => {
    const map = TableMap.get(currentNode);
    const $top = resolveCell(0, col);
    const $bottom = resolveCell(map.height - 1, col);
    if (!$top || !$bottom) return;
    const { view } = editor;
    view.dispatch(
      view.state.tr.setSelection(CellSelection.colSelection($top, $bottom)),
    );
    view.focus();
  };

  const selectRow = (row: number) => {
    const map = TableMap.get(currentNode);
    const $left = resolveCell(row, 0);
    const $right = resolveCell(row, map.width - 1);
    if (!$left || !$right) return;
    const { view } = editor;
    view.dispatch(
      view.state.tr.setSelection(CellSelection.rowSelection($left, $right)),
    );
    view.focus();
  };

  /** グリップの個数を列数/行数に合わせ、実セルの座標に重ねる。 */
  const layoutGrips = () => {
    const map = TableMap.get(currentNode);

    const sync = (
      container: HTMLElement,
      count: number,
      label: string,
      onSelect: (index: number) => void,
    ) => {
      while (container.childElementCount > count) {
        container.lastElementChild?.remove();
      }
      while (container.childElementCount < count) {
        const grip = document.createElement('div');
        grip.className = 'numenumd-table-grip';
        grip.setAttribute('role', 'button');
        const index = container.childElementCount;
        grip.setAttribute('aria-label', `Select ${label} ${index + 1}`);
        grip.addEventListener('mousedown', (event) => {
          event.preventDefault();
          const at = Array.prototype.indexOf.call(container.children, grip);
          if (at >= 0) onSelect(at);
        });
        container.appendChild(grip);
      }
    };

    sync(colGrips, map.width, 'column', selectColumn);
    sync(rowGrips, map.height, 'row', selectRow);

    const firstRow = table.rows[0];
    if (firstRow) {
      Array.from(colGrips.children).forEach((grip, i) => {
        const cell = firstRow.cells[i];
        if (!(grip instanceof HTMLElement) || !cell) return;
        const { offset, size } = measurable(cell);
        grip.style.left = `${offset}px`;
        grip.style.width = `${size}px`;
      });
    }
    Array.from(rowGrips.children).forEach((grip, i) => {
      const row = table.rows[i];
      if (!(grip instanceof HTMLElement) || !row) return;
      grip.style.top = `${row.offsetTop}px`;
      grip.style.height = `${row.offsetHeight}px`;
    });
  };

  /** カーソルがこの表の中にある間だけ操作 UI を出す。 */
  const syncActive = () => {
    const pos = tablePos();
    if (pos === null) return;
    const { from, to } = editor.state.selection;
    const inside = from >= pos && to <= pos + currentNode.nodeSize;
    dom.classList.toggle('is-active', inside);
  };

  const onTransaction = () => {
    syncActive();
    layoutGrips();
  };

  editor.on('transaction', onTransaction);
  layoutGrips();
  syncActive();

  return {
    dom,
    contentDOM: tbody,
    update: (updatedNode) => {
      if (updatedNode.type.name !== 'table') return false;
      currentNode = updatedNode;
      layoutGrips();
      syncActive();
      return true;
    },
    // 操作 UI 上のイベントは ProseMirror に渡さない(contentDOM の外なので
    // 選択やカーソル移動として解釈されると壊れる)。
    stopEvent: (event) => {
      const target = event.target;
      return target instanceof globalThis.Node && !tbody.contains(target);
    },
    ignoreMutation: (mutation) =>
      !tbody.contains(
        mutation.target instanceof globalThis.Node ? mutation.target : null,
      ),
    destroy: () => {
      editor.off('transaction', onTransaction);
    },
  };
};
