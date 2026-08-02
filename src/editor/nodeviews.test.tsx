// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from './Editor';
import { KeyRouter } from '../keymap/router';

afterEach(() => {
  cleanup();
  delete window.__numenumdEditor__;
});

async function mountWith(
  doc: Parameters<typeof MarkdownEditor>[0]['initialDoc'],
) {
  const onDocChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      initialDoc={doc}
      router={new KeyRouter()}
      onDocChange={onDocChange}
    />,
  );
  await vi.waitFor(() => {
    expect(window.__numenumdEditor__).toBeTruthy();
  });
  return { ...utils, onDocChange };
}

describe('mathBlock NodeView', () => {
  it('renders KaTeX and switches to a textarea on click, committing on blur', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }],
    });

    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    expect(mathDom!.querySelector('.katex')).toBeTruthy();

    act(() => {
      fireEvent.click(mathDom!);
    });
    const textarea = mathDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe('E = mc^2');

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'a^2 + b^2 = c^2' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.latex,
    ).toBe('a^2 + b^2 = c^2');
    // should have switched back to display mode
    expect(mathDom!.querySelector('textarea')).toBeNull();
    expect(mathDom!.querySelector('.katex')).toBeTruthy();
  });
});

describe('rawBlock NodeView', () => {
  it('shows content in a <pre> and edits via textarea on click', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'rawBlock', attrs: { content: '| a | b |\n|---|---|' } },
      ],
    });

    const rawDom = container.querySelector('[data-raw-block]');
    expect(rawDom!.querySelector('pre.numenumd-raw')?.textContent).toBe(
      '| a | b |\n|---|---|',
    );

    act(() => {
      fireEvent.click(rawDom!);
    });
    const textarea = rawDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'new raw content' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.content,
    ).toBe('new raw content');
  });
});

describe('frontmatter NodeView', () => {
  it('renders a details/summary and edits the inner pre via textarea', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'frontmatter', attrs: { content: 'title: Hello' } }],
    });

    const fmDom = container.querySelector('[data-frontmatter]');
    const details = fmDom!.querySelector('details.numenumd-frontmatter');
    expect(details).toBeTruthy();
    expect(details!.querySelector('summary')?.textContent).toBe('Front matter');
    expect(details!.querySelector('pre')?.textContent).toBe('title: Hello');

    act(() => {
      fireEvent.click(details!.querySelector('pre')!);
    });
    const textarea = fmDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'title: World' } });
      fireEvent.blur(textarea!);
    });

    expect(
      window.__numenumdEditor__!.getJSON().content?.[0]?.attrs?.content,
    ).toBe('title: World');
  });
});

describe('mathBlock creation focus (UX feedback)', () => {
  it('opens a newly created math block in edit mode with the textarea focused', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '$$' }] }],
    });
    const editor = window.__numenumdEditor__!;

    act(() => {
      editor.commands.setTextSelection(3); // after "$$"
      editor.commands.keyboardShortcut('Enter');
    });

    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    const textarea = mathDom!.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('does not steal focus for an empty math block that exists at load time', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: '' } }],
    });
    const mathDom = container.querySelector('[data-math-block]');
    expect(mathDom).toBeTruthy();
    expect(mathDom!.querySelector('textarea')).toBeNull();
  });
});

describe('mathBlock exit keys (UX feedback)', () => {
  const editAndPress = async (
    key: string,
    init: Partial<KeyboardEventInit>,
  ) => {
    const utils = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'x' } }],
    });
    const mathDom = utils.container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'x + y' } });
      fireEvent.keyDown(textarea, { key, ...init });
    });
    return { ...utils, mathDom };
  };

  it('Escape commits, closes the editor, and moves the cursor to a paragraph after the block', async () => {
    const { mathDom } = await editAndPress('Escape', {});
    const editor = window.__numenumdEditor__!;

    expect(mathDom.querySelector('textarea')).toBeNull();
    const json = editor.getJSON();
    expect(json.content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'x + y' },
    });
    // a paragraph is created after the block and the selection lands inside it
    expect(json.content?.[1]?.type).toBe('paragraph');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('Cmd+Enter commits and moves the cursor to the following paragraph', async () => {
    const { mathDom } = await editAndPress('Enter', { metaKey: true });
    const editor = window.__numenumdEditor__!;

    expect(mathDom.querySelector('textarea')).toBeNull();
    expect(editor.getJSON().content?.[1]?.type).toBe('paragraph');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('reuses an existing following paragraph instead of inserting a new one', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'a' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    const editor = window.__numenumdEditor__!;
    expect(editor.getJSON().content).toHaveLength(2);
    expect(editor.state.selection.$from.parent.textContent).toBe('tail');
  });
});

describe('mathBlock re-exit with unchanged content (bug report)', () => {
  it('closes the editor on Cmd+Enter even when the latex was not changed', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
        { type: 'paragraph' },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    const textarea = mathDom.querySelector('textarea')!;
    act(() => {
      // 値を変更せずにそのまま確定
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    });

    expect(mathDom.querySelector('textarea')).toBeNull();
    expect(mathDom.querySelector('.katex')).toBeTruthy();
    const editor = window.__numenumdEditor__!;
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('closes the editor on Escape when the latex was not changed', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'x' } }],
    });
    const mathDom = container.querySelector('[data-math-block]')!;
    act(() => {
      fireEvent.click(mathDom);
    });
    act(() => {
      fireEvent.keyDown(mathDom.querySelector('textarea')!, {
        key: 'Escape',
      });
    });
    expect(mathDom.querySelector('textarea')).toBeNull();
  });

  it('supports repeated open -> exit cycles without stacking click handlers', async () => {
    const { container } = await mountWith({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'a' } },
        { type: 'paragraph' },
      ],
    });
    const mathDom = container.querySelector('[data-math-block]')!;

    for (let i = 0; i < 3; i++) {
      act(() => {
        fireEvent.click(mathDom);
      });
      expect(mathDom.querySelectorAll('textarea')).toHaveLength(1);
      act(() => {
        fireEvent.keyDown(mathDom.querySelector('textarea')!, {
          key: 'Escape',
        });
      });
      expect(mathDom.querySelector('textarea')).toBeNull();
    }
  });
});
