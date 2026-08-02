// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from './Editor';
import { KeyRouter } from '../keymap/router';

afterEach(() => {
  cleanup();
  delete window.__numenumdEditor__;
});

describe('mathBlock full lifecycle: create via $$ -> exit -> reopen -> exit', () => {
  it('renders katex after the second exit', async () => {
    render(
      <MarkdownEditor
        initialDoc={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '$$' }] },
          ],
        }}
        router={new KeyRouter()}
        onDocChange={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(window.__numenumdEditor__).toBeTruthy();
    });
    const editor = window.__numenumdEditor__!;

    // 作成: "$$" 段落で Enter → mathBlock が編集モードで生成される
    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.keyboardShortcut('Enter');
    });
    const mathDom = document.querySelector('[data-math-block]')!;
    let ta = mathDom.querySelector('textarea');
    expect(ta, 'created in edit mode').toBeTruthy();

    // 1回目の入力と脱出
    act(() => {
      fireEvent.change(ta!, { target: { value: 'e = mc^2' } });
      fireEvent.keyDown(ta!, { key: 'Enter', metaKey: true });
    });
    expect(mathDom.querySelector('textarea'), '1st exit closes').toBeNull();
    expect(
      mathDom.querySelector('.katex'),
      '1st exit renders katex',
    ).toBeTruthy();

    // 2回目: クリックで再編集 → 変更して脱出
    act(() => {
      fireEvent.click(mathDom);
    });
    ta = mathDom.querySelector('textarea');
    expect(ta, 'reopens in edit mode').toBeTruthy();
    act(() => {
      fireEvent.change(ta!, { target: { value: 'e = mc^2 + 1' } });
      fireEvent.keyDown(ta!, { key: 'Enter', metaKey: true });
    });
    expect(mathDom.querySelector('textarea'), '2nd exit closes').toBeNull();
    expect(
      mathDom.querySelector('.katex'),
      '2nd exit still renders katex',
    ).toBeTruthy();
    expect(editor.getJSON().content?.[0]?.attrs?.latex).toBe('e = mc^2 + 1');
  });
});
