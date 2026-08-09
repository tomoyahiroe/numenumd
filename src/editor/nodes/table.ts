import { Extension, type Extensions } from '@tiptap/core';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { CellSelection } from 'prosemirror-tables';
import { tableNodeView } from './table-view';

export type CellAlignment = 'left' | 'center' | 'right' | null;

function readAlignment(element: HTMLElement): CellAlignment {
  const align = element.style.textAlign;
  return align === 'left' || align === 'center' || align === 'right'
    ? align
    : null;
}

/**
 * GFM の揃え記法(`:---` / `:---:` / `---:`)を往復させるためのセル属性。
 *
 * tiptap の `TableCell` / `TableHeader` は `colspan` / `rowspan` / `colwidth`
 * しか持たないため、この属性が無いと `| :---: |` がパース時に落ちて保存で
 * 消えてしまう(「ユーザーの Markdown を絶対に失わない」原則違反)。
 *
 * Markdown 上は列単位の指定だが、markdown-it は各セルに `style="text-align:…"`
 * を付けて配るため、こちらもセル単位で保持する。書き戻し時はヘッダ行のセルから
 * 列の揃えを読む(`serialize.ts`)。
 */
const alignmentAttribute = {
  alignment: {
    default: null as CellAlignment,
    parseHTML: (element: HTMLElement) => readAlignment(element),
    renderHTML: (attributes: Record<string, unknown>) => {
      const alignment = attributes.alignment as CellAlignment;
      return alignment ? { style: `text-align: ${alignment}` } : {};
    },
  },
};

/**
 * セルの中身を単一段落に制限する。
 *
 * tiptap の既定は `block+` で、セルの中にリスト・コードブロック・複数段落を
 * 作れてしまう。しかし GFM のセルに書けるのはインラインだけなので、それらは
 * 保存時に必ず壊れる(行が分断されて表そのものが崩れる)。書けないものは
 * そもそも作らせない、という方針を取る。
 */
const CELL_CONTENT = 'paragraph';

const TableCellStrict = TableCell.extend({
  content: CELL_CONTENT,
  addAttributes() {
    return { ...this.parent?.(), ...alignmentAttribute };
  },
});

const TableHeaderStrict = TableHeader.extend({
  content: CELL_CONTENT,
  addAttributes() {
    return { ...this.parent?.(), ...alignmentAttribute };
  },
});

const TableWithView = Table.extend({
  addNodeView() {
    return tableNodeView;
  },
});

/**
 * セル内のキーボード挙動の調整。`Table` 拡張(priority 既定)より先に
 * ハンドラを走らせる必要があるため優先度を上げている。
 *
 * - `Shift-Enter`(hardBreak): GFM のセルは改行を表現できない。既定のまま
 *   通すと `\` が書き出されて表が壊れるので、セル内では握り潰す。
 * - `Backspace` / `Delete`: 行グリップ・列グリップのクリックで作られる
 *   `CellSelection` に対して、行/列そのものを削除する。`Table` 拡張の既定
 *   ハンドラは「全セル選択で表ごと削除」しか見ていないため、その手前で
 *   行選択・列選択を拾う(全セル選択のときは既定の挙動に委ねる)。
 */
const TableCellKeymap = Extension.create({
  name: 'numenumdTableCellKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    const deleteRowOrColumn = () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof CellSelection)) return false;
      const isRow = selection.isRowSelection();
      const isCol = selection.isColSelection();
      // 行選択かつ列選択 = 表全体。Table 拡張の「表ごと削除」に任せる。
      if (isRow && isCol) return false;
      if (isRow) return this.editor.commands.deleteRow();
      if (isCol) return this.editor.commands.deleteColumn();
      return false;
    };

    return {
      'Shift-Enter': () =>
        this.editor.isActive('tableCell') ||
        this.editor.isActive('tableHeader'),
      Backspace: deleteRowOrColumn,
      Delete: deleteRowOrColumn,
    };
  },
});

/**
 * 表まわりの拡張一式。`resizable` は既定の false のまま(列幅は GFM に
 * 書けないので保持できない)。セル結合コマンドは UI から一切呼ばない
 * (GFM のパイプテーブルにセル結合の記法自体が存在しないため)。
 */
export function tableExtensions(): Extensions {
  return [
    TableWithView,
    TableRow,
    TableHeaderStrict,
    TableCellStrict,
    TableCellKeymap,
  ];
}
