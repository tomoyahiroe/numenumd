import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from 'prosemirror-model';
import MarkdownIt from 'markdown-it';
import type {
  MarkdownIt as MarkdownItInstance,
  StateBlock,
  StateCore,
  StateInline,
  Token,
} from 'markdown-it';
import { MarkdownParser, type ParseSpec } from 'prosemirror-markdown';
import { buildExtensions } from '../editor/extensions';
import type { CellAlignment } from '../editor/nodes/table';
import { splitFrontmatter } from './frontmatter';
import { matchMathSpanAt } from './math-spans';
import { splitTableRow } from './table-cells';
import { matchFootnoteMarkerAt, matchImageSpanAt } from './verbatim-spans';

const TASK_ITEM_RE = /^\[([ xX])\]\s+/;

const TEXT_ALIGN_RE = /text-align:\s*(left|center|right)/;

/**
 * ブロック数式ルール: 行頭 `$$` から次の `$$` のみの行までを
 * 単一の `math_block` トークンにする(fence と同じ骨格)。
 *
 * 開き `$$` と閉じ `$$` が同じ行にある1行完結形 `$$latex$$` も受ける。
 * Obsidian・GitHub をはじめ多くのレンダラがこの書き方を display math として
 * 扱うため、そちら由来の `.md` には普通に現れる。かつてはこの形を弾いており
 * (開き行の残りを空白のみに限定していた)、インライン側も `matchMathSpanAt` が
 * `$$` 隣接を除外するため、どちらにも拾われず素のテキストとして描画されていた。
 *
 * 1行完結形かどうかは `token.meta.singleLine` に載せて `serialize.ts` へ渡す。
 * ユーザーが1行で書いた数式を保存時に3行へ広げてしまわないため
 * (Prettier は `$$Y = X + a$$` を段落として扱いこの行に触らないので、
 * 広げると numenumd だけが起こす差分になってしまう)。
 */
function mathBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  const max = state.eMarks[startLine] ?? start;
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false;
  if (state.src.slice(start, start + 2) !== '$$') return false;

  const rest = state.src.slice(start + 2, max).trim();
  if (rest.length > 0) {
    // 開き行に続きがある場合、1行完結形 `$$latex$$` のときだけ成立させる。
    // `$$latex$` や `$$latex$$tail` のような中途半端な形は従来どおり不成立
    // (段落テキストとして扱う)。
    if (!rest.endsWith('$$')) return false;
    if (silent) return true;
    state.line = startLine + 1;
    const token = state.push('math_block', '', 0);
    token.content = rest.slice(0, -2);
    token.markup = '$$';
    token.meta = { singleLine: true };
    token.map = [startLine, state.line];
    return true;
  }
  if (silent) return true;

  let nextLine = startLine;
  let haveEndMarker = false;
  for (;;) {
    nextLine++;
    if (nextLine >= endLine) break;
    const lineStart =
      (state.bMarks[nextLine] ?? 0) + (state.tShift[nextLine] ?? 0);
    const lineMax = state.eMarks[nextLine] ?? lineStart;
    if (state.src.slice(lineStart, lineMax).trim() === '$$') {
      haveEndMarker = true;
      break;
    }
  }

  state.line = nextLine + (haveEndMarker ? 1 : 0);
  const token = state.push('math_block', '', 0);
  token.content = state.getLines(
    startLine + 1,
    nextLine,
    state.blkIndent,
    true,
  );
  token.markup = '$$';
  token.map = [startLine, state.line];
  return true;
}

/**
 * インライン数式 `$...$` の中身を、CommonMark のバックスラッシュエスケープや
 * 強調(`*`/`_`)・コードスパンなど他のインラインルールに解釈させず、
 * verbatim なテキストとして保持するための markdown-it インラインルール。
 *
 * numenumd はインライン数式を専用ノード/マークにせず、プレーンテキストとして
 * 保持する方針(KaTeX による装飾描画は tiptap 側の Mathematics 拡張が担う)。
 * しかしこのルールを入れないと `$...$` の中身が通常のインラインパイプラインを
 * 通ってしまい、例えば `\%` や `\{` のような CommonMark のバックスラッシュ
 * エスケープが解決されて `%` や `{` に化けてしまい、ユーザーの LaTeX が
 * 書き戻し不能な形で壊れる。
 *
 * `$...$` かどうかの判定(Pandoc 流ヒューリスティック: 開き `$` の直後が
 * 非空白、閉じ `$` の直前が非空白かつ直後が数字でない、等)は
 * `matchMathSpanAt`(`./math-spans`)に委譲している。これは
 * `serialize.ts` の `safeEsc` と全く同じロジックを共有するためで、
 * パースとシリアライズで検出規則が食い違うと往復が壊れてしまう
 * (例: 地の文中の `The price is $5 and *sale* items are $10 today.` の
 * ような、対になっていない `$` を数式と誤認して `*sale*` の強調記法を
 * 壊してしまう、という回帰が実際に起きたため)。
 *
 * マッチした範囲はまるごと1個の `text` トークンとして切り出すことで、
 * 中身を他のインラインルールから完全に保護する。
 */
function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const closePos = matchMathSpanAt(state.src, start, state.posMax);
  if (closePos === null) return false;

  if (!silent) {
    const token = state.push('text', '', 0);
    token.content = state.src.slice(start, closePos + 1);
  }
  state.pos = closePos + 1;
  return true;
}

/**
 * 画像記法 `![alt](src)` / `![alt][ref]` を、markdown-it の `image` ルールより
 * 先に verbatim なテキストとして切り出すインラインルール(`math_inline` と同手法)。
 *
 * スキーマに `image` ノードが無いため、画像はいずれにせよプレーンテキストとして
 * 保持するしかない(`inlineFallbackToTextRule` を参照)。ただしそのフォールバック
 * 経路は `image` トークンの属性から `![alt](src)` を組み立て直すため、
 * 参照形式 `![alt][ref]` が inline 形式へ潰れる・`<...>` 括りの src や
 * シングルクォートの title といった元の書き方が失われる、という不可逆な
 * 正規化が起きる。ここで原文をそのまま1個の `text` トークンとして切り出すことで、
 * ユーザーが書いたバイト列をそのまま往復させる。
 *
 * 判定は `matchImageSpanAt`(`./verbatim-spans`)に委譲し、`serialize.ts` の
 * `safeEsc` と全く同じロジックを共有する(検出規則が食い違うと往復が壊れる)。
 */
function imageVerbatimRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const end = matchImageSpanAt(state.src, start, state.posMax);
  if (end === null) return false;

  if (!silent) {
    const token = state.push('text', '', 0);
    token.content = state.src.slice(start, end);
  }
  state.pos = end;
  return true;
}

/**
 * GFM 脚注マーカー `[^label]` を、markdown-it の `link` ルールより先に verbatim な
 * テキストとして切り出すインラインルール。
 *
 * markdown-it(CommonMark)は脚注を知らないため、定義行 `[^1]: note` を
 * ただの参照リンク定義として `state.env.references` に登録してしまう。すると
 * 本文中の `[^1]` が参照リンクとして解決され、保存すると `text[^1](note)` という
 * 別物の記法に化ける。定義行が無い場合も `safeEsc` によって `a\[^note\] b` に
 * エスケープされてしまう。どちらもユーザーの記法を無警告で壊す。
 *
 * 定義行そのもの(`[^1]: note`)は `raw_reference`(`wrapAsRawBlock('reference')`)
 * が `rawBlock` として verbatim 保全するため、ここではインラインのマーカーだけを
 * 保護すればよい。
 */
function footnoteMarkerRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const end = matchFootnoteMarkerAt(state.src, start, state.posMax);
  if (end === null) return false;

  if (!silent) {
    const token = state.push('text', '', 0);
    token.content = state.src.slice(start, end);
  }
  state.pos = end;
  return true;
}

/**
 * markdown-it 内部の `getLine`(`rules_block/table.ts`)と同一の行取得。
 * コンテナ(blockquote・list)の中では `bMarks`/`tShift` がマーカーの後ろを
 * 指すよう調整済みなので、これだけで `> ` やインデントを含まない行が得られる。
 */
function getLine(state: StateBlock, line: number): string {
  const pos = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
  const max = state.eMarks[line] ?? pos;
  return state.src.slice(pos, max);
}

/**
 * この表を編集可能な `table` ノードに変換すると、ユーザーが書いた情報が
 * 落ちてしまうかどうかを判定する。
 *
 * GFM(および markdown-it の実装)は、本文行がヘッダ行より多いセルを持つとき
 * 超過分を**黙って捨てる**(`for (let i = 0; i < columnCount; i++)` で
 * ヘッダのセル数までしかトークンを作らない)。この状態で `table` ノードに
 * してしまうと、保存した瞬間にユーザーが書いたセルが消える。
 *
 * そこで超過セルを持つ表だけは従来どおり `rawBlock` として verbatim 保全し、
 * 編集対象から外す(「ユーザーの Markdown を絶対に失わない」原則)。
 * 逆にセル数が足りない行は空セルが補完されるだけで情報は落ちないため、
 * 変換を許す。
 *
 * セルの数え方は必ず `splitTableRow`(markdown-it の `escapedSplit` と同一)を
 * 使う。ここで数え方がズレると、変換して良い表かどうかの判断そのものが
 * 狂ってしまう。
 *
 * @param endLine 表の終端(= 元ルール実行後の `state.line`、排他)
 */
function tableDropsCells(
  state: StateBlock,
  startLine: number,
  endLine: number,
): boolean {
  const headerCells = splitTableRow(getLine(state, startLine)).length;
  // 本文行は「ヘッダ行 + デリミタ行」の次から表の終端まで。
  for (let line = startLine + 2; line < endLine; line++) {
    if (splitTableRow(getLine(state, line)).length > headerCells) return true;
  }
  return false;
}

/**
 * 指定した名前のブロックルール(`table` / `html_block` / `reference`)を
 * verbatim 保全な単一の `raw_block` トークンへ差し替えるラッパーを作る。
 *
 * これらのブロックが blockquote やリストの中に出現すると、行頭の `> ` や
 * インデントは `state.src` の行そのものには残ったままになる(ブロック解析中に
 * `state.bMarks`/`blkIndent` 側で「読み飛ばす」だけで元の文字列を書き換えないため)。
 * そのため、単純に `state.src.split('\n')` で行範囲をスライスすると
 * コンテナのマーカー文字が verbatim テキストに混入してしまう。
 *
 * これを避けるため、当該ブロックの実際の判定・トークン化は元のルール関数を
 * そのまま呼び出して行い(`state.env.references` の更新など副作用も保持される)、
 * 生成されたトークン列だけを破棄して、`fence`/`math_block` と同じ
 * `state.getLines(start, end, state.blkIndent, true)` によるコンテナ考慮済みの
 * verbatim テキストで単一の `raw_block` トークンに置き換える。
 *
 * `shouldWrap` を渡した場合は、元ルールが成立したうえでその述語が true を
 * 返したときだけ `raw_block` へ差し替える。false のときは元ルールが積んだ
 * トークンをそのまま通す(表のハイブリッド判定に使う。`tableDropsCells` 参照)。
 */
function wrapAsRawBlock(
  originalName: 'table' | 'html_block' | 'reference',
  shouldWrap?: (
    state: StateBlock,
    startLine: number,
    endLine: number,
  ) => boolean,
): (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean {
  return (state, startLine, endLine, silent) => {
    const rule = state.md.block.ruler.__rules__.find(
      (r) => r.name === originalName && r.enabled,
    );
    if (!rule) return false;

    const tokenCountBefore = state.tokens.length;
    const matched = rule.fn(state, startLine, endLine, silent);
    if (!matched || silent) return matched;

    const endLine2 = state.line;
    if (shouldWrap && !shouldWrap(state, startLine, endLine2)) return true;
    // 元のルールが積んだトークン(table_open...table_close、html_block、
    // reference_definition 等)は使わず、raw_block 1個に差し替える。
    state.tokens.length = tokenCountBefore;
    const raw = state.push('raw_block', '', 0);
    raw.content = state
      .getLines(startLine, endLine2, state.blkIndent, true)
      .replace(/\n$/, '');
    raw.map = [startLine, endLine2];
    return true;
  };
}

/**
 * markdown-it は `- [x] foo` をただの箇条書きとして解釈する。
 * ここで `list_item_open` 直後の段落先頭が `[x] ` / `[ ] ` のリストを検出し、
 * `bullet_list_open/close` → `task_list_open/close`、
 * `list_item_open/close` → `task_item_open/close` に改名して `checked` 属性を仕込む。
 * マーカー文字列自体はテキストから除去する。
 */
function taskListRule(state: StateCore): void {
  const { tokens } = state;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== 'bullet_list_open') continue;

    let depth = 0;
    let closeIdx = -1;
    for (let j = i; j < tokens.length; j++) {
      const type = tokens[j]!.type;
      if (type === 'bullet_list_open') depth++;
      else if (type === 'bullet_list_close') {
        depth--;
        if (depth === 0) {
          closeIdx = j;
          break;
        }
      }
    }
    if (closeIdx === -1) continue;

    const itemIndices: number[] = [];
    let listDepth = 0;
    for (let j = i; j <= closeIdx; j++) {
      const type = tokens[j]!.type;
      if (type === 'bullet_list_open' || type === 'ordered_list_open')
        listDepth++;
      if (type === 'bullet_list_close' || type === 'ordered_list_close')
        listDepth--;
      if (type === 'list_item_open' && listDepth === 1) itemIndices.push(j);
    }
    if (itemIndices.length === 0) continue;

    const inlineIdxByItem: number[] = [];
    let isTaskList = true;
    for (const itemIdx of itemIndices) {
      const paragraphOpen = tokens[itemIdx + 1];
      const inline = tokens[itemIdx + 2];
      if (
        paragraphOpen?.type !== 'paragraph_open' ||
        inline?.type !== 'inline'
      ) {
        isTaskList = false;
        break;
      }
      if (!TASK_ITEM_RE.test(inline.content)) {
        isTaskList = false;
        break;
      }
      inlineIdxByItem.push(itemIdx + 2);
    }
    if (!isTaskList) continue;

    tokens[i]!.type = 'task_list_open';
    tokens[closeIdx]!.type = 'task_list_close';

    itemIndices.forEach((itemIdx, k) => {
      const inlineIdx = inlineIdxByItem[k]!;
      const inlineToken = tokens[inlineIdx]!;
      const match = TASK_ITEM_RE.exec(inlineToken.content);
      const checked = match?.[1]?.toLowerCase() === 'x';
      tokens[itemIdx]!.type = 'task_item_open';
      tokens[itemIdx]!.attrSet('checked', checked ? 'true' : 'false');
      inlineToken.content = inlineToken.content.slice(match?.[0].length ?? 0);

      let d = 0;
      for (let j = itemIdx; j <= closeIdx; j++) {
        const type = tokens[j]!.type;
        if (type === 'list_item_open') d++;
        if (type === 'list_item_close') {
          d--;
          if (d === 0) {
            tokens[j]!.type = 'task_item_close';
            break;
          }
        }
      }
    });
  }
}

/**
 * 表のセル(`th` / `td`)の中身を `paragraph` トークンで包む core ルール。
 *
 * markdown-it は `th_open, inline, th_close` という「セル直下にインライン」の
 * 形でトークンを積むが、本スキーマの `tableCell` / `tableHeader` は
 * content を `paragraph` に制限している(GFM のセルにはインラインしか書けない
 * ため、リストやコードブロックを作らせない方針。spec 参照)。
 *
 * この食い違いを放置すると、`MarkdownParser` の `closeNode` が呼ぶ
 * `type.createAndFill()` が「テキストを直接子に持つ tableCell」を作れずに
 * `null` を返し、**セルが黙って消える**(例外も出ない)。ここで段落を挿して
 * スキーマに合わせる。
 */
function tableCellParagraphRule(state: StateCore): void {
  const wrapped: Token[] = [];
  for (const tok of state.tokens) {
    if (tok.type === 'th_close' || tok.type === 'td_close') {
      wrapped.push(new state.Token('paragraph_close', 'p', -1));
    }
    wrapped.push(tok);
    if (tok.type === 'th_open' || tok.type === 'td_open') {
      wrapped.push(new state.Token('paragraph_open', 'p', 1));
    }
  }
  state.tokens = wrapped;
}

/**
 * スキーマに `image` ノードが存在しないため、インライン画像は完全に消えてしまう
 * (`image` トークンにハンドラが無いと MarkdownParser が例外を投げ、`parseBody` の
 * フォールバックで文書全体が単一 rawBlock に潰れてしまう)。
 * 同様に `html_inline`(`<br>` 等、`html: true` のとき生成される)にもハンドラが無い。
 *
 * ここでは、画像は `![alt](src)`(title があれば `![alt](src "title")`)という
 * Markdown 表記そのものをプレーンテキストとして保持し、インライン HTML は元の
 * 生テキスト(`token.content` は元の該当タグの verbatim 文字列)をそのまま
 * テキストとして保持する。ノード種別が無い以上「見た目」は失われるが、
 * 文字情報(alt/src/title、生 HTML 片)は失われず、かつ段落単位の構造も保たれる。
 * `inline` core ルールの後(children が生成された後)に実行する必要がある。
 */
function inlineFallbackToTextRule(state: StateCore): void {
  for (const tok of state.tokens) {
    if (tok.type !== 'inline' || !tok.children) continue;
    for (const child of tok.children) {
      if (child.type === 'image') {
        const src = child.attrGet('src') ?? '';
        const title = child.attrGet('title');
        const alt = child.content;
        child.type = 'text';
        child.content = title
          ? `![${alt}](${src} "${title}")`
          : `![${alt}](${src})`;
        child.children = null;
      } else if (child.type === 'html_inline') {
        // token.content は元のタグの verbatim テキストなのでそのまま text 化する。
        child.type = 'text';
      }
    }
  }
}

function buildMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true });
  md.block.ruler.before('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  // table / html_block / reference(参照リンク定義)は、コンテナ(blockquote・list)の
  // マーカーを混入させずに verbatim 保全するため、post-hoc なトークン置換ではなく
  // ブロックルールそのものをラップする(wrapAsRawBlock 参照)。
  // 表は「情報が落ちる場合だけ」rawBlock に落とす(それ以外は編集可能な
  // table ノードとして通す)。判定は tableDropsCells を参照。
  md.block.ruler.before(
    'table',
    'raw_table',
    wrapAsRawBlock('table', tableDropsCells),
    { alt: ['paragraph', 'reference'] },
  );
  md.block.ruler.before(
    'reference',
    'raw_reference',
    wrapAsRawBlock('reference'),
  );
  md.block.ruler.before(
    'html_block',
    'raw_html_block',
    wrapAsRawBlock('html_block'),
    {
      alt: ['paragraph', 'reference', 'blockquote'],
    },
  );
  // verbatim 保全系のインラインルールは、対応する組み込みルール
  // (`escape` / `image` / `link`)より前に置く必要があるため `escape` の前に挿す。
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.inline.ruler.before('escape', 'image_verbatim', imageVerbatimRule);
  md.inline.ruler.before('escape', 'footnote_marker', footnoteMarkerRule);
  md.core.ruler.before('inline', 'task_list', taskListRule);
  md.core.ruler.push('table_cell_paragraph', tableCellParagraphRule);
  md.core.ruler.push('inline_fallback_to_text', inlineFallbackToTextRule);
  return md;
}

/**
 * markdown-it が各セルに配る `style="text-align:…"` から揃えを読む。
 * Markdown 上の指定は列単位(デリミタ行の `:---:`)だが、トークンには
 * セル単位で乗ってくる。
 */
function alignmentOf(tok: Token): CellAlignment {
  const style = tok.attrGet('style');
  if (!style) return null;
  const matched = TEXT_ALIGN_RE.exec(String(style));
  return (matched?.[1] as CellAlignment | undefined) ?? null;
}

function buildTokenMap(): Record<string, ParseSpec> {
  return {
    paragraph: { block: 'paragraph' },
    blockquote: { block: 'blockquote' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList' },
    ordered_list: {
      block: 'orderedList',
      getAttrs: (tok) => ({ start: Number(tok.attrGet('start')) || 1 }),
    },
    task_list: { block: 'taskList' },
    task_item: {
      block: 'taskItem',
      getAttrs: (tok) => ({ checked: tok.attrGet('checked') === 'true' }),
    },
    heading: {
      block: 'heading',
      getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }),
    },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: {
      block: 'codeBlock',
      getAttrs: (tok) => ({ language: tok.info || null }),
      noCloseToken: true,
    },
    math_block: {
      node: 'mathBlock',
      getAttrs: (tok) => ({
        latex: tok.content.trim(),
        singleLine:
          (tok.meta as { singleLine?: boolean } | null)?.singleLine === true,
      }),
      noCloseToken: true,
    },
    raw_block: {
      node: 'rawBlock',
      getAttrs: (tok) => ({ content: tok.content }),
      noCloseToken: true,
    },
    // 表。`thead` / `tbody` はスキーマに対応ノードが無い(table の content は
    // `tableRow+`)ので読み飛ばす。セルの中身は `tableCellParagraphRule` が
    // 挿した `paragraph` トークンが受ける。
    table: { block: 'table' },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: 'tableRow' },
    th: {
      block: 'tableHeader',
      getAttrs: (tok) => ({ alignment: alignmentOf(tok) }),
    },
    td: {
      block: 'tableCell',
      getAttrs: (tok) => ({ alignment: alignmentOf(tok) }),
    },
    hr: { node: 'horizontalRule' },
    hardbreak: { node: 'hardBreak' },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    // title(`[t](href "title")` の第2引数)を落とすとユーザーの記述が
    // 無音で失われるため、スキーマ側(extensions.ts の LinkWithTitle)に
    // 足した `title` 属性へ引き渡す。
    link: {
      mark: 'link',
      getAttrs: (tok) => ({
        href: tok.attrGet('href'),
        title: tok.attrGet('title') || null,
      }),
    },
    code_inline: { mark: 'code', noCloseToken: true },
  };
}

let cachedParser: MarkdownParser | null = null;
let cachedSchema: Schema | null = null;

function getSchemaSingleton(): Schema {
  cachedSchema ??= getSchema(buildExtensions());
  return cachedSchema;
}

function getParser(): MarkdownParser {
  if (!cachedParser) {
    cachedParser = new MarkdownParser(
      getSchemaSingleton(),
      buildMarkdownIt(),
      buildTokenMap(),
    );
  }
  return cachedParser;
}

/**
 * ユーザーの Markdown 本文を、パース不能な部分があっても失わずに
 * 単一の `rawBlock` として保全しつつ ProseMirror の doc JSON へ変換する。
 */
function parseBody(body: string): JSONContent {
  try {
    return getParser().parse(body).toJSON() as JSONContent;
  } catch {
    // 未対応トークンなどでパースに失敗した場合は、本文全体を rawBlock として
    // verbatim に保全する(ユーザーの Markdown を絶対に失わない原則)。
    return {
      type: 'doc',
      content:
        body.length > 0 ? [{ type: 'rawBlock', attrs: { content: body } }] : [],
    };
  }
}

export function parseMarkdown(md: string): JSONContent {
  const { frontmatter, body } = splitFrontmatter(md);
  const bodyDoc = parseBody(body);
  const content: JSONContent[] = [];
  if (frontmatter !== null) {
    content.push({ type: 'frontmatter', attrs: { content: frontmatter } });
  }
  content.push(...(bodyDoc.content ?? []));
  return { type: 'doc', content };
}
