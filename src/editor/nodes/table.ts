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
 * 1行あたりの上限列数。
 *
 * 実在の HTML には「全幅」のつもりで `colspan="99"` と書かれた表があり、
 * 悪意が無くても大きな値は飛んでくる。`colspan` を実体化する以上、上限は
 * こちら側で持つ必要がある。
 *
 * **セル単位ではなく行単位で数える。** 以前はセルごとに上限を掛けていたが、
 * それだと `colspan="1000"` のセルを10個並べるだけで640列に膨らみ、
 * 「上限列数」を名乗りながら列数を全く抑えられていなかった(独立レビューでの
 * 指摘。5KB 程度の HTML で Node が OOM するところまで再現された)。
 */
const MAX_COLUMNS_PER_ROW = 64;

/**
 * 1回の貼り付けで作ってよいセル数の総量。
 *
 * 行数は入力サイズに比例するが、`flattenTable` が全行を最大幅までパディング
 * するため、1行だけ広い表があると行数 × 最大幅まで増える。行単位の上限だけでは
 * この掛け算を抑えられないので、総量にも予算を持たせる。
 *
 * 予算を使い切った後は展開もパディングも行わない。セルの内容は先頭セルに
 * 残るので**情報は失われない**(見た目の列数が頭打ちになるだけ)。
 */
const MAX_TOTAL_CELLS = 4096;

/** 1回の `transformPasted` で使えるセル数の残り。 */
type CellBudget = { left: number };

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
 * セル1個を GFM で書ける形に均し、`colspan` の分だけ横に展開する。
 *
 * - `colspan` は「内容を持つセル + 空セル」に展開する(内容は失わない)。
 * - `rowspan` は 1 に落とす。
 * - `colwidth` は GFM に書けないので落とす。
 * - セル内の `hardBreak`(`<br>`)は空白に潰す。残すと `\` が書き出されるうえ、
 *   セル末尾では無音で消える。
 *
 * @param room この呼び出しで作ってよいセル数の上限(行の残り幅)
 */
function normalizeCell(
  cell: PMNode,
  room: number,
  budget: CellBudget,
): PMNode[] {
  const limit = Math.max(1, Math.min(room, budget.left));
  const colspan = Math.min(limit, Math.max(1, Number(cell.attrs.colspan) || 1));
  const attrs = { ...cell.attrs, colspan: 1, rowspan: 1, colwidth: null };

  const out = [cell.type.create(attrs, stripHardBreaks(cell.content))];
  for (let i = 1; i < colspan; i++) {
    const filler = cell.type.createAndFill(attrs);
    if (!filler) break;
    out.push(filler);
  }
  budget.left -= out.length;
  return out;
}

/** 行1本を均す。1行が `MAX_COLUMNS_PER_ROW` を超えないようにする。 */
function normalizeRow(row: PMNode, budget: CellBudget): PMNode {
  const cells: PMNode[] = [];
  row.forEach((cell) => {
    const room = MAX_COLUMNS_PER_ROW - cells.length;
    if (room <= 0) return; // 上限に達したら以降のセルは展開しない
    cells.push(...normalizeCell(cell, room, budget));
  });
  return row.type.create(row.attrs, cells);
}

/**
 * 貼り付けられた表を、GFM のパイプテーブルとして必ず書き出せる形に均す。
 *
 * tiptap の `TableCell` / `TableHeader` は `parseHTML` で `colspan` / `rowspan`
 * を読むため、ウェブページの結合セル入り表を貼るとそのままドキュメントに入る。
 * GFM のパイプテーブルは結合を表現できず、`serialize.ts` は安全側に倒して
 * 例外を投げるので、**貼った瞬間から文書全体が保存できなくなる**。
 *
 * 行の長さが不揃いなまま残ると、書き出し時に短い行が空セルで埋められて
 * 見た目が変わる。ここで最大幅に揃えておく。
 */
function flattenTable(table: PMNode, budget: CellBudget): PMNode {
  const rows: PMNode[][] = [];
  table.forEach((row) => {
    const normalized = normalizeRow(row, budget);
    const cells: PMNode[] = [];
    normalized.forEach((cell) => cells.push(cell));
    rows.push(cells);
  });

  const width = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
  const rebuilt: PMNode[] = [];
  rows.forEach((cells, index) => {
    const row = table.child(index);
    const cellType = cells[0]?.type ?? row.type.schema.nodes.tableCell!;
    // パディングも予算の対象。1行だけ広い表があると行数 × 最大幅まで増える。
    while (cells.length < width && budget.left > 0) {
      const filler = cellType.createAndFill();
      if (!filler) break;
      cells.push(filler);
      budget.left -= 1;
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

/**
 * フラグメントを再帰的に走査し、表まわりのノードを均す。
 *
 * **`table` だけを見てはいけない。** ProseMirror の `parseFromClipboard` は、
 * クリップボード HTML が `<tr>` / `<td>` / `<thead>` など表の内部タグで始まる
 * とき仮の `<table>` を被せてパースし、その後 `<table>` の内側まで降りてから
 * スライスを切り出す。結果、スライスのトップレベルが `tableRow` や
 * `tableCell` になる。2行以上あれば `normalizeSiblings` が `table` に包み直す
 * ので救われるが、**1行/1セルだけだと包まれない**。
 *
 * 当初は `table` だけを対象にしていたため、ウェブページの表を部分選択して
 * コピーするだけで結合セルが素通しし、貼った文書が保存不能になったままだった
 * (独立レビューで8ケース中6ケースが再現。「経路は2つ、両方塞いだ」という
 * 当時のコメントは数え漏れだった)。経路を数え上げて宣言する代わりに、
 * `table-paste.test.ts` に経路のマトリクスをテストとして持たせてある。
 */
function flattenTablesIn(fragment: Fragment, budget: CellBudget): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    const name = node.type.name;
    if (name === 'table') {
      out.push(flattenTable(node, budget));
    } else if (name === 'tableRow') {
      out.push(normalizeRow(node, budget));
    } else if (name === 'tableCell' || name === 'tableHeader') {
      out.push(...normalizeCell(node, MAX_COLUMNS_PER_ROW, budget));
    } else if (node.content.size > 0) {
      out.push(node.copy(flattenTablesIn(node.content, budget)));
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
              // 予算は貼り付け1回ごとにリセットする。
              flattenTablesIn(slice.content, { left: MAX_TOTAL_CELLS }),
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
