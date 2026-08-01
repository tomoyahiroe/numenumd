import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from 'prosemirror-model';
import MarkdownIt from 'markdown-it';
import type {
  MarkdownIt as MarkdownItInstance,
  StateBlock,
  StateCore,
} from 'markdown-it';
import { MarkdownParser, type ParseSpec } from 'prosemirror-markdown';
import { buildExtensions } from '../editor/extensions';
import { splitFrontmatter } from './frontmatter';

const TASK_ITEM_RE = /^\[([ xX])\]\s+/;

/**
 * ブロック数式ルール: 行頭 `$$` から次の `$$` のみの行までを
 * 単一の `math_block` トークンにする(fence と同じ骨格)。
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
  // 行の残りが空白のみであること(`$$latex-inline$` のような誤検出を防ぐ)
  if (state.src.slice(start + 2, max).trim().length > 0) return false;
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
 */
function wrapAsRawBlock(
  originalName: 'table' | 'html_block' | 'reference',
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
  md.block.ruler.before('table', 'raw_table', wrapAsRawBlock('table'), {
    alt: ['paragraph', 'reference'],
  });
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
  md.core.ruler.before('inline', 'task_list', taskListRule);
  md.core.ruler.push('inline_fallback_to_text', inlineFallbackToTextRule);
  return md;
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
      getAttrs: (tok) => ({ latex: tok.content.trim() }),
      noCloseToken: true,
    },
    raw_block: {
      node: 'rawBlock',
      getAttrs: (tok) => ({ content: tok.content }),
      noCloseToken: true,
    },
    hr: { node: 'horizontalRule' },
    hardbreak: { node: 'hardBreak' },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href') }) },
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
