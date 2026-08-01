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
