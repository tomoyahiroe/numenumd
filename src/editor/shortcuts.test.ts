// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';

// `Editor` は破棄しないと内部の DOM 監視タイマーが動き続け、次のテスト
// ファイルへ環境が切り替わるタイミングで `document is not defined` の
// 未処理例外を断続的に発生させる(既存のフレーク要因)。各テスト後に
// 確実に破棄する。
const createdEditors: Editor[] = [];
const makeEditor = () => {
  const editor = new Editor({ extensions: buildExtensions() });
  createdEditors.push(editor);
  return editor;
};

afterEach(() => {
  vi.restoreAllMocks();
  while (createdEditors.length > 0) {
    createdEditors.pop()?.destroy();
  }
});

describe('mathBlock input automation', () => {
  it('converts "$$ " typed at the start of a paragraph into a mathBlock', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p></p>');
    const { view } = editor;
    view.someProp('handleTextInput', (f) =>
      f(view, 1, 1, '$$ ', () => view.state.tr),
    );
    expect(editor.getJSON().content?.[0]?.type).toBe('mathBlock');
  });

  it('converts a paragraph containing only "$$" into a mathBlock on Enter', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '$$' }] }],
    });
    editor.commands.setTextSelection(3); // end of "$$"
    editor.commands.keyboardShortcut('Enter');
    expect(editor.getJSON().content?.[0]?.type).toBe('mathBlock');
  });
});

describe('bare "[] " task list conversion', () => {
  // `@tiptap/extension-task-item` の標準 inputRegex
  // (`/^\s*(\[([( |x])?\])\s$/`) は括弧内の文字が省略可能なため、
  // `"- [ ] "` 形式に加えて素の `"[] "` / `"[x] "` も直接
  // taskList>taskItem への変換をトリガーする(findWrapping が
  // 必要な taskList ラッパーを自動挿入する)。これはこちら独自の追加実装
  // ではなく TaskItem のデフォルト動作の回帰カバレッジであり、将来
  // `@tiptap/extension-task-item` の regex が変わった場合に検知できる
  // ようにするための恒久テスト。
  it('converts "[] " at the start of a paragraph into an unchecked taskItem', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p></p>');
    const { view } = editor;
    view.someProp('handleTextInput', (f) =>
      f(view, 1, 1, '[] ', () => view.state.tr),
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false } }],
    });
  });

  it('converts "[x] " at the start of a paragraph into a checked taskItem', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p></p>');
    const { view } = editor;
    view.someProp('handleTextInput', (f) =>
      f(view, 1, 1, '[x] ', () => view.state.tr),
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true } }],
    });
  });
});

describe('Cmd+K link shortcut', () => {
  it('sets a link on the current selection using window.prompt', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 }); // "hello"
    vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    const handled = editor.commands.keyboardShortcut('Mod-k');
    expect(handled).toBe(true);
    expect(editor.getAttributes('link').href).toBe('https://example.com');
  });

  it('unsets the link when the prompt is answered with an empty string', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setLink({ href: 'https://example.com' });
    vi.spyOn(window, 'prompt').mockReturnValue('');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.keyboardShortcut('Mod-k');
    expect(editor.getAttributes('link').href).toBeUndefined();
  });

  it('does nothing when the selection is empty', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection(1);
    const promptSpy = vi.spyOn(window, 'prompt');
    editor.commands.keyboardShortcut('Mod-k');
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe('Cmd+Shift+X strike shortcut', () => {
  // spec(docs/superpowers/specs/2026-08-01-numenumd-design.md)は取り消し線を
  // `Cmd+Shift+X` と定めているが、StarterKit 経由の `@tiptap/extension-strike`
  // の既定キーマップは `Mod-Shift-s` のみ。`extensions.ts` の
  // `StrikeExtraKeymap` が `Mod-Shift-x` を追加でバインドしていることを確認する
  // (既定の `Mod-Shift-s` も引き続き有効であることも併せて確認する)。
  it('toggles the strike mark on the current selection', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 }); // "hello"
    const handled = editor.commands.keyboardShortcut('Mod-Shift-x');
    expect(handled).toBe(true);
    expect(editor.isActive('strike')).toBe(true);
  });

  it('toggles the strike mark back off on a second press', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.keyboardShortcut('Mod-Shift-x');
    editor.commands.keyboardShortcut('Mod-Shift-x');
    expect(editor.isActive('strike')).toBe(false);
  });

  it('the default Mod-Shift-s keymap still works alongside it', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const handled = editor.commands.keyboardShortcut('Mod-Shift-s');
    expect(handled).toBe(true);
    expect(editor.isActive('strike')).toBe(true);
  });
});
