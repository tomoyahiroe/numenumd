import { Extension, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Mathematics from '@tiptap/extension-mathematics';
import { MathBlock } from './nodes/math-block';
import { RawBlock } from './nodes/raw-block';
import { Frontmatter } from './nodes/frontmatter';
import { tableExtensions } from './nodes/table';
import { SlashCommand } from './slash/suggestion';
import { createMathSpanRegex } from '../markdown/math-spans';

/**
 * `@tiptap/extension-link` の `addAttributes()` は `href` / `target` / `rel` /
 * `class` しか定義しておらず、`title` 属性を持たない。そのため
 * `[t](https://x.jp "Title")` をパースしても title がスキーマに保持されず、
 * 保存時に無音で失われてしまう(「ユーザーの Markdown を絶対に失わない」原則違反)。
 *
 * 親の属性定義に `title` を足すだけで、
 * - パース: `parse.ts` の link マークの `getAttrs` が `tok.attrGet('title')` を渡す
 * - シリアライズ: `prosemirror-markdown` の既定 link マーク(`d.marks.link`)が
 *   `mark.attrs.title` を `](href "title")` として書き戻す
 * の両側が繋がり、往復で title が保存される。
 */
const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

/**
 * `Link` 拡張には `Mod-k` のデフォルトキーマップが無いため、選択範囲に対して
 * `window.prompt('URL')` の値でリンクを設定/解除する小さな Extension を追加する。
 * 空文字が入力された場合はリンクを解除する。
 */
const LinkKeymap = Extension.create({
  name: 'numenumdLinkKeymap',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const { empty } = this.editor.state.selection;
        if (empty) return false;
        const previousUrl = this.editor.getAttributes('link').href as
          string | undefined;
        const url = window.prompt('URL', previousUrl ?? '');
        if (url === null) return true;
        if (url.trim() === '') {
          return this.editor.chain().focus().unsetLink().run();
        }
        return this.editor.chain().focus().setLink({ href: url }).run();
      },
    };
  },
});

/**
 * spec(docs/superpowers/specs/2026-08-01-numenumd-design.md)は取り消し線の
 * ショートカットを `Cmd+Shift+X` と定めているが、StarterKit 経由の
 * `@tiptap/extension-strike` の既定キーマップは `Mod-Shift-s` のみである。
 * 既定を上書きするのではなく、`Mod-Shift-x` を追加で `toggleStrike()` に
 * バインドする(`Mod-Shift-s` も引き続き有効なまま両方効く状態にする)。
 */
const StrikeExtraKeymap = Extension.create({
  name: 'numenumdStrikeExtraKeymap',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
    };
  },
});

export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    LinkWithTitle.configure({ openOnClick: false }),
    LinkKeymap,
    StrikeExtraKeymap,
    // インライン $…$ を KaTeX デコレーションで描画する。
    // 既定の `regex`(`/\$([^$]*)\$/gi`)は「$ に挟まれていれば何でも数式」と
    // みなすため、`The price is $5 and $10 today.` のような地の文の金額表記を
    // 数式として誤レンダリングしてしまう。一方、保存系(parse.ts の
    // math_inline / serialize.ts の safeEsc)は `math-spans` の Pandoc 流
    // ヒューリスティックで判定しており、表示系と保存系で検出規則が乖離していた。
    // `createMathSpanRegex()`(math-spans が単一ソースとして提供)を渡して
    // 両者の判定を揃える。
    Mathematics.configure({ regex: createMathSpanRegex() }),
    MathBlock,
    RawBlock,
    Frontmatter,
    ...tableExtensions(),
    SlashCommand,
  ];
}
