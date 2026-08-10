import {
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import { getSchema, type JSONContent } from '@tiptap/core';
import { Node as PMNode } from 'prosemirror-model';
import { buildExtensions } from '../editor/extensions';
import { stripHardBreaks, type CellAlignment } from '../editor/nodes/table';
import { joinFrontmatter } from './frontmatter';
import { escapeTableCell } from './table-cells';
import { findVerbatimSpans } from './verbatim-spans';

const schema = getSchema(buildExtensions());
const d = defaultMarkdownSerializer;

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** リストアイテム先頭のタスクマーカー(`[x] ` / `[X] ` / `[ ] `)。 */
const LIST_ITEM_TASK_MARKER_RE = /^\[[ xX]\] /;

/**
 * `parse.ts` の `taskListRule` は「全アイテムがタスク記法のリスト」だけを
 * `taskList` に変換する(部分的な変換はリスト構造の分割を伴うため)。
 * その結果 `- [x] done` と `- plain` が混在したリストは `bulletList` のまま
 * 保持され、`[x]` は単なる段落テキストになる。ところが `safeEsc` は `[` と `]`
 * を常時エスケープするため、保存すると `- \[x\] done` に化けてしまい、
 * GitHub 等の GFM レンダラでチェックボックスとして表示されなくなる
 * (= ユーザーから見て記法が壊れる)。
 *
 * そこで `listItem` のシリアライズ中だけ「先頭のタスクマーカーはエスケープ
 * しない」ことを `safeEsc` に伝えるフラグを立てる。判定を `safeEsc` の中の
 * 文字列パターンだけで行うと、リストの文脈でない普通の段落(`[x] foo` で
 * 始まる本文)まで巻き込んでしまうため、文脈を知っている `listItem` の
 * レンダラ側で制御する。
 *
 * 往復の冪等性: 書き出した `- [x] done\n- plain\n` を再パースしても、
 * `taskListRule` は全アイテム一致でないため `bulletList` のままになり、
 * 同じ doc → 同じ出力になる。
 */
let unescapeLeadingTaskMarker = false;

/**
 * 表のセルを描画している間だけ true。
 *
 * `safeEsc` の `startOfLine` 分岐は、行頭の `- ` `# ` `1. ` `> ` を
 * 「ブロック記法として解釈されないように」エスケープする。しかし表のセルの
 * 中では箇条書きも見出しも始められないので、このエスケープは意味を持たない。
 * 効かせたままだと `| - x |` が `| \- x |` に化けて、ユーザーが書いた記述と
 * 見た目が変わってしまう(往復自体は安定するが、無意味なノイズが増える)。
 *
 * セルの描画は `renderTableCell` が別 serializer を再入させる形で行うため、
 * 文脈を知っているそちら側でフラグを立てる(`unescapeLeadingTaskMarker` と
 * 同じ流儀)。
 */
let insideTableCell = false;

/** `listItem` の先頭が段落で、その先頭テキストがタスクマーカーで始まるか。 */
function hasLeadingTaskMarker(node: PMNode): boolean {
  const firstBlock = node.firstChild;
  if (!firstBlock || firstBlock.type.name !== 'paragraph') return false;
  const firstInline = firstBlock.firstChild;
  if (!firstInline?.isText || !firstInline.text) return false;
  return LIST_ITEM_TASK_MARKER_RE.test(firstInline.text);
}

function isInsideRange(
  ranges: Array<[number, number]>,
  index: number,
): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * `MarkdownSerializerState.esc()` の既定実装は、素のバックスラッシュを
 * 文脈を問わず常に `\` → `\\` へエスケープし、`` ` `` `*` `~` `[` `]` `_`
 * も常時エスケープする。しかしインライン数式はノード/マークを持たない
 * プレーンテキストとして保持しているため(Task 4 の方針)、これをそのまま
 * 適用すると LaTeX コマンド `\alpha` が `\\alpha` に、`$x_{i}$` が
 * `$x\_{i}$` に、`$a^{*}$` が `$a^{\*}$` になるなど、数式が壊れてしまう。
 *
 * 同じ問題は、同様にプレーンテキストとして保持している他の記法でも起きる:
 * 画像 `![alt](src)` は `!\[alt\](src)` に化けてどのレンダラでも表示されなくなり、
 * GFM 脚注マーカー `[^1]` は `\[^1\]` に化ける。どちらも無警告・復旧不能で、
 * 「ユーザーの Markdown を絶対に失わない」原則への正面違反だった。
 *
 * 対策は二段構え:
 * 1. `$...$` / `![...](...)` / `[^...]` の範囲内にある文字は一切エスケープ
 *    しない(`findVerbatimSpans` / `isInsideRange`)。`findVerbatimSpans` は
 *    `parse.ts` の `math_inline` / `image_verbatim` / `footnote_marker`
 *    ルールと全く同じ判定ロジック(`./verbatim-spans`・`./math-spans`)を
 *    共有しており、検出規則が食い違うと「パース時には保護されたのに
 *    シリアライズ時にはエスケープされる(またはその逆)」という往復破壊が
 *    起きるため、必ず同じ実装を使う。
 *    なお免除は `!` で始まる画像形式と `[^` 脚注のみで、地の文に現れた
 *    `[t](u)` 風の文字列は従来どおりエスケープする(通常リンクは `link`
 *    マークから serializer が正しく生成するため、免除すると再パース時に
 *    意図しないリンクへ化けてしまう)。
 * 2. 範囲外のバックスラッシュについても、CommonMark でエスケープ記号として
 *    意味を持つのは直後が ASCII 記号(punctuation)の場合のみで、`\` の
 *    直後が英字などの場合はパース時にバックスラッシュはそのまま残る
 *    (エスケープ扱いされない)ため、直後が ASCII 記号でないバックスラッシュは
 *    エスケープ不要と判断する。
 *
 * それ以外の文字クラスの扱いは既定実装と同一。
 */
function safeEsc(
  this: MarkdownSerializerState,
  str: string,
  startOfLine = false,
): string {
  const verbatimRanges = findVerbatimSpans(str);
  // `- [x] done` の先頭 `[` / `]`(offset 0 / 2)だけエスケープを免除する。
  // `startOfLine`(= `MarkdownSerializerState.atBlockStart`)はブロック先頭の
  // 最初のテキストでのみ true になるため、当該アイテムの先頭テキストだけに
  // 確実に一致する。一度使ったらフラグは消費する。
  let taskMarkerSkipLen = 0;
  if (
    unescapeLeadingTaskMarker &&
    startOfLine &&
    LIST_ITEM_TASK_MARKER_RE.test(str)
  ) {
    unescapeLeadingTaskMarker = false;
    taskMarkerSkipLen = 3;
  }
  let result = str.replace(/[`*\\~[\]_]/g, (m: string, offset: number) => {
    if (offset < taskMarkerSkipLen) return m;
    if (isInsideRange(verbatimRanges, offset)) return m;
    if (
      m === '_' &&
      offset > 0 &&
      offset + 1 < str.length &&
      /\w/.test(str[offset - 1] ?? '') &&
      /\w/.test(str[offset + 1] ?? '')
    ) {
      return m;
    }
    if (m === '\\') {
      const next = str[offset + 1];
      if (next === undefined || !ASCII_PUNCTUATION.test(next)) return m;
    }
    return '\\' + m;
  });
  if (startOfLine && !insideTableCell) {
    result = result
      .replace(/^(\+[ ]|[-*>])/, '\\$&')
      .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
      .replace(/^(\s*\d+)\.\s/, '$1\\. ');
  }
  return result;
}

/** 揃え属性 → デリミタ行のセル表記。 */
const ALIGNMENT_DELIMITER: Record<'left' | 'center' | 'right', string> = {
  left: ':---',
  center: ':---:',
  right: '---:',
};

/**
 * 1個のセル(単一段落)を、パイプテーブルのセルに置ける1行の文字列にする。
 *
 * `MarkdownSerializerState` はセル単位で文字列を取り出す公開 API を持たない
 * ため、段落だけを含む一時 doc を**別の `MarkdownSerializer` インスタンス**で
 * シリアライズして結果を受け取る。`esc` は `serializeMarkdown` がプロトタイプに
 * 張った `safeEsc` がそのまま効くので、インライン数式・画像・脚注の verbatim
 * 免除も本文と同じ規則で働く。
 *
 * 最後に `escapeTableCell` で `|` を潰す。これをやらないと1セルが2セルに割れて
 * 表の形が変わってしまう。
 */
function renderTableCell(cell: PMNode): string {
  const paragraph = cell.firstChild;
  if (!paragraph || paragraph.childCount === 0) return '';
  // `hardBreak` が残っていると prosemirror-markdown が `\` を書き出し
  // (ユーザーが打っていないバックスラッシュが混入する)、セル末尾の
  // `hardBreak` に至っては無音で消える。空白に潰してから書き出す。
  const doc = schema.node('doc', null, [
    paragraph.copy(stripHardBreaks(paragraph.content)),
  ]);
  const previous = insideTableCell;
  insideTableCell = true;
  let rendered: string;
  try {
    rendered = cellSerializer.serialize(doc, { tightLists: true });
  } finally {
    insideTableCell = previous;
  }
  return escapeTableCell(rendered.trim());
}

function tableRowStrings(node: PMNode): string[][] {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const { colspan, rowspan } = cell.attrs as {
        colspan: number;
        rowspan: number;
      };
      if (colspan !== 1 || rowspan !== 1) {
        // GFM のパイプテーブルにセル結合の記法は存在しない。
        //
        // **ここが到達不能だと宣言しない。** かつて2度、到達経路を数え上げて
        // 「塞いだ」と書き、2度とも数え漏れていた(1度目は「UI から作れない」、
        // 2度目は「編集とペーストの2経路」— どちらもペーストの一部形状を
        // 見落としており、ウェブページの表を貼るだけで文書が保存不能になって
        // いた)。経路の網羅は `editor/nodes/table.ts` の `transformPasted` が
        // 担い、その網羅性は `table-paste.test.ts` の経路マトリクスで担保する。
        // 新しい経路が見つかったらコメントではなくテストを足すこと。
        //
        // throw を残すのは、黙って壊れた表を書き出すより保存を失敗させるほうが
        // 原則に沿うため(ユーザーが気づける)。ここに到達したら、それは
        // マトリクスに無い経路が見つかったということ。
        throw new Error(
          'numenumd: merged table cells cannot be written as a GFM pipe table',
        );
      }
      cells.push(renderTableCell(cell));
    });
    rows.push(cells);
  });
  return rows;
}

type NodeSerializers = ConstructorParameters<typeof MarkdownSerializer>[0];
type MarkSerializers = ConstructorParameters<typeof MarkdownSerializer>[1];

const nodeSerializers: NodeSerializers = {
  paragraph: d.nodes.paragraph!,
  heading: d.nodes.heading!,
  blockquote: d.nodes.blockquote!,
  // 既定の code_block は `node.attrs.params` を読むが、本スキーマの
  // codeBlock ノードの言語属性は `language`(tiptap CodeBlock の attrs 名)
  // なので、フェンス情報文字列にそれを使う独自実装にする。
  codeBlock: (state, node) => {
    const backticks = node.textContent.match(/`{3,}/gm);
    const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
    state.write(fence + (node.attrs.language || '') + '\n');
    state.text(node.textContent, false);
    state.write('\n');
    state.write(fence);
    state.closeBlock(node);
  },
  bulletList: (state, node) => state.renderList(node, '  ', () => '- '),
  // 既定の ordered_list は `node.attrs.order` を読むが、本スキーマの
  // orderedList ノードの開始番号属性は `start`(tiptap OrderedList の attrs 名)
  // なのでそれを使う独自実装にする。
  orderedList: (state, node) => {
    const start = (node.attrs.start as number | undefined) ?? 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, (i) => {
      const nStr = String(start + i);
      return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
    });
  },
  // 既定の list_item は `state.renderContent(node)` するだけ。ここでは
  // 先頭のタスクマーカーをエスケープさせないフラグ制御だけを足している
  // (`unescapeLeadingTaskMarker` の説明を参照)。
  listItem: (state, node) => {
    const previous = unescapeLeadingTaskMarker;
    unescapeLeadingTaskMarker = hasLeadingTaskMarker(node);
    try {
      state.renderContent(node);
    } finally {
      unescapeLeadingTaskMarker = previous;
    }
  },
  taskList: (state, node) => state.renderList(node, '  ', () => '- '),
  taskItem: (state, node) => {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  mathBlock: (state, node) => {
    state.write('$$\n');
    state.text(node.attrs.latex, false);
    state.ensureNewLine();
    state.write('$$');
    state.closeBlock(node);
  },
  rawBlock: (state, node) => {
    state.text(node.attrs.content, false);
    state.closeBlock(node);
  },
  /**
   * GFM パイプテーブル。桁揃えはしない(保存フローの Prettier が整形する)。
   *
   * `state.write()` を1行ずつ使うのは、blockquote やリストの中に表がある
   * ときに各行へコンテナのデリミタ(`> ` 等)を付けてもらうため。
   */
  table: (state, node) => {
    // セルの描画は別 serializer を再入させるので、listItem 用のモジュール
    // スコープのフラグが漏れないよう退避しておく。
    const previousFlag = unescapeLeadingTaskMarker;
    unescapeLeadingTaskMarker = false;
    let rows: string[][];
    try {
      rows = tableRowStrings(node);
    } finally {
      unescapeLeadingTaskMarker = previousFlag;
    }
    if (rows.length === 0) return;

    const width = Math.max(...rows.map((row) => row.length));
    const line = (cells: string[]) => {
      const padded = Array.from({ length: width }, (_, i) => cells[i] ?? '');
      return `| ${padded.join(' | ')} |`;
    };

    // 揃えは列単位の情報なので、ヘッダ行のセルから読む。
    const alignments: CellAlignment[] = [];
    node.firstChild?.forEach((cell) => {
      alignments.push((cell.attrs.alignment as CellAlignment) ?? null);
    });
    const delimiters = Array.from({ length: width }, (_, i) => {
      const alignment = alignments[i];
      return alignment ? ALIGNMENT_DELIMITER[alignment] : '---';
    });

    state.write(line(rows[0]!));
    state.ensureNewLine();
    state.write(`| ${delimiters.join(' | ')} |`);
    for (const row of rows.slice(1)) {
      state.ensureNewLine();
      state.write(line(row));
    }
    state.closeBlock(node);
  },
  // 表の行/セルは `table` レンダラが自分で走査して文字列を組み立てるため、
  // 通常これらが呼ばれることはない。呼ばれたら想定外の doc 構造なので、
  // 黙って空文字を返さず落とす。
  tableRow: () => {
    throw new Error('numenumd: tableRow must be rendered by the table node');
  },
  tableHeader: () => {
    throw new Error('numenumd: tableHeader must be rendered by the table node');
  },
  tableCell: () => {
    throw new Error('numenumd: tableCell must be rendered by the table node');
  },
  // frontmatter ノードは本文中では何も出力しない(serializeMarkdown 側で
  // ドキュメントの先頭 `---` ブロックとして別途合成するため、そもそも
  // この nodes マップに渡す doc から取り除いてある。念のためのフォールバック)。
  frontmatter: (state, node) => state.closeBlock(node),
  text: d.nodes.text!,
  hardBreak: d.nodes.hard_break!,
  horizontalRule: d.nodes.horizontal_rule!,
};

const markSerializers: MarkSerializers = {
  bold: d.marks.strong!,
  italic: d.marks.em!,
  code: d.marks.code!,
  link: d.marks.link!,
  strike: {
    open: '~~',
    close: '~~',
    mixable: true,
    expelEnclosingWhitespace: true,
  },
};

const serializer = new MarkdownSerializer(nodeSerializers, markSerializers);

/**
 * セル1個を文字列化するための2本目の serializer(`renderTableCell` が使う)。
 * ノード/マークの定義は本体と同一なので、セルの中でもリンク・強調・コードなど
 * 本文とまったく同じ規則で書き出される。
 */
const cellSerializer = new MarkdownSerializer(nodeSerializers, markSerializers);

export function serializeMarkdown(docJson: JSONContent): string {
  const content = docJson.content ?? [];
  const fmNode = content.find((n) => n.type === 'frontmatter');
  const bodyContent = content.filter((n) => n.type !== 'frontmatter');
  const frontmatter = fmNode ? String(fmNode.attrs?.content ?? '') : null;

  let body = '';
  if (bodyContent.length > 0) {
    const bodyDoc = PMNode.fromJSON(schema, {
      type: 'doc',
      content: bodyContent,
    });
    // esc() をリスクの低い形で差し替えるため、シリアライズ呼び出しの間だけ
    // プロトタイプを一時的に patch し、直後に必ず元へ戻す(同期処理なので
    // 呼び出しの間に他のコードが割り込むことはない)。
    const originalEsc = MarkdownSerializerState.prototype.esc;
    MarkdownSerializerState.prototype.esc = safeEsc;
    try {
      body = serializer.serialize(bodyDoc, { tightLists: true });
    } finally {
      MarkdownSerializerState.prototype.esc = originalEsc;
      // 例外で listItem / table レンダラの finally を抜けられなかった場合に
      // 備え、モジュールスコープのフラグが次回の呼び出しへ漏れないようにする。
      unescapeLeadingTaskMarker = false;
      insideTableCell = false;
    }
  }

  return joinFrontmatter(frontmatter, body).replace(/\n*$/, '\n');
}
