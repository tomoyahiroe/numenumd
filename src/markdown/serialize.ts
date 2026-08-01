import {
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import { getSchema, type JSONContent } from '@tiptap/core';
import { Node as PMNode } from 'prosemirror-model';
import { buildExtensions } from '../editor/extensions';
import { joinFrontmatter } from './frontmatter';

const schema = getSchema(buildExtensions());
const d = defaultMarkdownSerializer;

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * `MarkdownSerializerState.esc()` の既定実装は、素のバックスラッシュを
 * 文脈を問わず常に `\` → `\\` へエスケープする。しかしインライン数式は
 * ノード/マークを持たないプレーンテキストとして保持しているため
 * (Task 4 の方針)、これをそのまま適用すると LaTeX コマンド `\alpha` が
 * `\\alpha` に化けて数式が壊れてしまう。
 *
 * CommonMark でバックスラッシュがエスケープ記号として意味を持つのは
 * 直後が ASCII 記号(punctuation)の場合のみで、`\` の直後が英字などの
 * 場合はパース時にバックスラッシュはそのまま残る(エスケープ扱いされない)。
 * そのため、直後が ASCII 記号でないバックスラッシュはエスケープ不要と
 * 判断し、既定の esc() 相当のロジックにこの条件だけを追加した派生実装で
 * 上書きする(その他の文字クラスの扱いは既定実装と同一)。
 */
function safeEsc(
  this: MarkdownSerializerState,
  str: string,
  startOfLine = false,
): string {
  let result = str.replace(/[`*\\~[\]_]/g, (m: string, offset: number) => {
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
  if (startOfLine) {
    result = result
      .replace(/^(\+[ ]|[-*>])/, '\\$&')
      .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
      .replace(/^(\s*\d+)\.\s/, '$1\\. ');
  }
  return result;
}

const serializer = new MarkdownSerializer(
  {
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
    listItem: d.nodes.list_item!,
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
    // frontmatter ノードは本文中では何も出力しない(serializeMarkdown 側で
    // ドキュメントの先頭 `---` ブロックとして別途合成するため、そもそも
    // この nodes マップに渡す doc から取り除いてある。念のためのフォールバック)。
    frontmatter: (state, node) => state.closeBlock(node),
    text: d.nodes.text!,
    hardBreak: d.nodes.hard_break!,
    horizontalRule: d.nodes.horizontal_rule!,
  },
  {
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
  },
);

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
    }
  }

  return joinFrontmatter(frontmatter, body).replace(/\n*$/, '\n');
}
