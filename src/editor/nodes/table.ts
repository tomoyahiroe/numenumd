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
 * 1個の `colspan` を展開してよい上限。
 *
 * 実在の HTML には「全幅」のつもりで `colspan="99"` と書かれた表があり、
 * 悪意が無くても大きな値は飛んでくる。`colspan="200000"` をそのまま実体化すると
 * 20万個の空セルが生まれてタブが固まるので、ここで頭打ちにする。
 *
 * **抑えるのは空セルの生成だけで、実在するセルは絶対に捨てない。** 一時期
 * 「1行あたりの上限」として実装していたが、それは上限を超えた分の**実セル**まで
 * 落としており(70セル貼ると64セルしか残らない)、「ユーザーの Markdown を
 * 絶対に失わない」という第一原則に違反していた。100列の表を全選択コピーして
 * 貼り直すだけで35列が消える、という退行を独立レビューで指摘されて撤回した。
 *
 * したがって列数そのものに上限は無い。100列の表を貼れば100列できる。
 * 重い表を貼れば重いのは受け入れる ─ 重さは原則違反ではないが、欠落は違反。
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
 * セル1個を GFM で書ける形に均し、`colspan` の分だけ横に展開する。
 *
 * - `colspan` は「内容を持つセル + 空セル」に展開する。展開数は
 *   `MAX_COLSPAN_EXPANSION` で頭打ちにするが、**内容を持つセルは常に1個
 *   出力する**ので、このクランプで情報が落ちることはない。
 * - `rowspan` は 1 に落とす。
 * - `colwidth` は GFM に書けないので落とす。
 * - セル内の `hardBreak`(`<br>`)は空白に潰す。残すと `\` が書き出されるうえ、
 *   セル末尾では無音で消える。
 */
function normalizeCell(cell: PMNode): PMNode[] {
  const colspan = Math.min(
    MAX_COLSPAN_EXPANSION,
    Math.max(1, Number(cell.attrs.colspan) || 1),
  );
  const attrs = { ...cell.attrs, colspan: 1, rowspan: 1, colwidth: null };

  const out = [cell.type.create(attrs, stripHardBreaks(cell.content))];
  for (let i = 1; i < colspan; i++) {
    const filler = cell.type.createAndFill(attrs);
    if (!filler) break;
    out.push(filler);
  }
  return out;
}

/** 行1本を均す。セルは1個も落とさない。 */
function normalizeRow(row: PMNode): PMNode {
  const cells: PMNode[] = [];
  row.forEach((cell) => cells.push(...normalizeCell(cell)));
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
 *
 * なお矩形化を途中でやめても意味がない。prosemirror-tables の `tableEditing`
 * が `appendTransaction` で `fixTables` を走らせ、不揃いな行を最大幅まで
 * 埋め直すためである(一時期ここに総セル数の予算を入れていたが、doc の
 * セル数は1個も減っていなかった。独立レビューで実測により指摘された)。
 */
function flattenTable(table: PMNode): PMNode {
  const rows: PMNode[][] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    normalizeRow(row).forEach((cell) => cells.push(cell));
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
 *
 * `tableRow` に専用の分岐は要らない。下の汎用再帰が子の `tableCell` /
 * `tableHeader` を正規化するため、結果は完全に同一になる(本物のペースト
 * 経路で doc の JSON を突き合わせて確認済み)。一時期あった `tableRow` 分岐は
 * 行あたりの列数を cap するためのもので、その cap が実セルを捨てていたため
 * 撤回した。テストで区別できないコードは残さない。
 */
function flattenTablesIn(fragment: Fragment): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    const name = node.type.name;
    if (name === 'table') {
      out.push(flattenTable(node));
    } else if (name === 'tableCell' || name === 'tableHeader') {
      out.push(...normalizeCell(node));
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
