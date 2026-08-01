// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MarkdownEditor } from './Editor';
import { KeyRouter } from '../keymap/router';
import { parseMarkdown } from '../markdown/parse';

afterEach(() => {
  cleanup();
  delete window.__numenumdEditor__;
});

describe('MarkdownEditor', () => {
  it('renders initial markdown content', async () => {
    render(
      <MarkdownEditor
        initialDoc={parseMarkdown('# Hello')}
        router={new KeyRouter()}
        onDocChange={() => {}}
      />,
    );
    expect(await screen.findByText('Hello')).toBeTruthy();
  });

  it('calls onDocChange when content changes', async () => {
    const onDocChange = vi.fn();
    render(
      <MarkdownEditor
        initialDoc={parseMarkdown('x')}
        router={new KeyRouter()}
        onDocChange={onDocChange}
      />,
    );

    await waitFor(() => {
      expect(window.__numenumdEditor__).toBeTruthy();
    });

    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });

    expect(onDocChange).toHaveBeenCalled();
    const lastDoc = onDocChange.mock.calls.at(-1)?.[0];
    const text = JSON.stringify(lastDoc);
    expect(text).toContain('x');
    expect(text).toContain('y');
  });
});
