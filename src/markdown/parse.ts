import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from 'prosemirror-model';
import MarkdownIt from 'markdown-it';
import type {
  MarkdownIt as MarkdownItInstance,
  StateBlock,
  StateCore,
  Token,
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

/** table / html_block のトークン列を、元テキストを verbatim に保持した単一の raw_block トークンへ潰す。 */
function rawBlockRule(state: StateCore): void {
  const { tokens } = state;
  const lines = state.src.split('\n');
  const out: Token[] = [];

  const sliceByMap = (
    map: [number, number] | null,
    fallback: string,
  ): string => {
    if (!map) return fallback.replace(/\n+$/, '');
    const [start, end] = map;
    return lines.slice(start, end).join('\n');
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'table_open') {
      let j = i;
      while (j < tokens.length && tokens[j]!.type !== 'table_close') j++;
      const raw = new state.Token('raw_block', '', 0);
      raw.content = sliceByMap(t.map, t.content);
      raw.map = t.map;
      out.push(raw);
      i = j;
      continue;
    }
    if (t.type === 'html_block') {
      const raw = new state.Token('raw_block', '', 0);
      raw.content = sliceByMap(t.map, t.content);
      raw.map = t.map;
      out.push(raw);
      continue;
    }
    out.push(t);
  }

  state.tokens = out;
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

function buildMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true });
  md.block.ruler.before('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.before('inline', 'raw_block', rawBlockRule);
  md.core.ruler.before('inline', 'task_list', taskListRule);
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
