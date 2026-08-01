// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';

const makeEditor = () => new Editor({ extensions: buildExtensions() });

afterEach(() => {
  vi.restoreAllMocks();
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
