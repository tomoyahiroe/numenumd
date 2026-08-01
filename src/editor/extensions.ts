import { Extension, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Mathematics from '@tiptap/extension-mathematics';
import { MathBlock } from './nodes/math-block';
import { RawBlock } from './nodes/raw-block';
import { Frontmatter } from './nodes/frontmatter';

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

export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false }),
    LinkKeymap,
    Mathematics, // インライン $…$ を KaTeX デコレーションで描画
    MathBlock,
    RawBlock,
    Frontmatter,
  ];
}
