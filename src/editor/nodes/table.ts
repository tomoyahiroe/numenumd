import { Extension, type Extensions } from '@tiptap/core';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { tableNodeView } from './table-view';

export type CellAlignment = 'left' | 'center' | 'right' | null;

/**
 * 貼り付けられた `colspan` を展開するときの上限列数。
 *
 * 実在の HTML には「全幅」のつもりで `colspan="99"` と書かれた表があり、
 * 悪意が無くても大きな値は飛んでくる。GFM の表として現実的に扱える列数を
 * 大きく超えたところで頭打ちにする(超過分は単に展開しないだけで、セルの
 * 内容は先頭セルに残るので情報は失われない)。
 */
const MAX_COLSPAN_EXPANSION = 64;

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

/**
 * 貼り付けられた表を、GFM のパイプテーブルとして必ず書き出せる形に均す。
 *
 * tiptap の `TableCell` / `TableHeader` は `parseHTML` で `colspan` / `rowspan`
 * を読むため、ウェブページの結合セル入り `<table>` を貼るとそのまま
 * ドキュメントに入る。GFM のパイプテーブルは結合を表現できず、
 * `serialize.ts` は安全側に倒して例外を投げるので、**貼った瞬間から文書全体が
 * 保存できなくなる**(独立レビューでの指摘。「UI から作れないので到達しない」
 * という当初の想定が誤りだった)。
 *
 * ここで結合をほどいておけば、シリアライザ側の例外は本当に到達不能になる。
 * - `colspan` は「内容を持つセル + 空セル」に展開する(内容は失わない)。
 * - `rowspan` は 1 に落とす。行が短くなった分は空セルで埋め、表を矩形に保つ。
 * - `colwidth` は GFM に書けないので落とす。
 * - セル内の `hardBreak`(`<br>`)は空白に潰す。残すと `\` が書き出されるうえ、
 *   セル末尾では無音で消える。
 */
function flattenTable(table: PMNode): PMNode {
  const rows: PMNode[][] = [];

  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => {
      // クリップボードの中身は信用できない。tiptap は colspan を parseInt する
      // だけでクランプしないため、`<td colspan="200000">` を貼られると
      // 20万セルを実体化し(実測: 40万セル/179ms)、他の行も同じ幅まで
      // パディングされてタブが固まる。属性を展開する方式にした以上、上限は
      // こちら側で持つ必要がある。
      const colspan = Math.min(
        MAX_COLSPAN_EXPANSION,
        Math.max(1, Number(cell.attrs.colspan) || 1),
      );
      const attrs = { ...cell.attrs, colspan: 1, rowspan: 1, colwidth: null };
      cells.push(cell.type.create(attrs, stripHardBreaks(cell.content)));
      for (let i = 1; i < colspan; i++) {
        const filler = cell.type.createAndFill(attrs);
        if (filler) cells.push(filler);
      }
    });
    rows.push(cells);
  });

  const width = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
  const rebuilt: PMNode[] = [];
  rows.forEach((cells, index) => {
    const row = table.child(index);
    const cellType = cells[0]?.type ?? row.type.schema.nodes.tableCell!;
    while (cells.length < width) {
      const filler = cellType.createAndFill();
      if (!filler) break;
      cells.push(filler);
    }
    rebuilt.push(row.type.create(row.attrs, cells));
  });

  return table.type.create(table.attrs, rebuilt);
}

/**
 * `hardBreak` を空白テキストへ置き換える(セルの中では改行を表現できない)。
 *
 * ペースト経路(この拡張の `transformPasted`)と、書き出し直前
 * (`serialize.ts` の `renderTableCell`)の両方から呼ぶ。前者だけだと
 * ペースト以外の経路で入り込んだ `hardBreak` が `\` として書き出され、
 * 後者だけだと画面には改行が見えているのに保存すると空白に変わる、という
 * 見た目と保存内容の食い違いが起きる。
 */
export function stripHardBreaks(fragment: Fragment): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'hardBreak') {
      out.push(node.type.schema.text(' '));
    } else if (node.content.size > 0) {
      out.push(node.copy(stripHardBreaks(node.content)));
    } else {
      out.push(node);
    }
  });
  return Fragment.fromArray(out);
}

/** フラグメントを再帰的に走査し、`table` ノードだけ差し替える。 */
function flattenTablesIn(fragment: Fragment): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'table') {
      out.push(flattenTable(node));
    } else if (node.content.size > 0) {
      out.push(node.copy(flattenTablesIn(node.content)));
    } else {
      out.push(node);
    }
  });
  return Fragment.fromArray(out);
}

const TableWithView = Table.extend({
  addNodeView() {
    return tableNodeView;
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          transformPasted: (slice) =>
            new Slice(
              flattenTablesIn(slice.content),
              slice.openStart,
              slice.openEnd,
            ),
        },
      }),
    ];
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
