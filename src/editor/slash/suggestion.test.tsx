import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { Editor } from '@tiptap/core';
import tippy from 'tippy.js';
import { renderSlashMenu, SlashMenu, type SlashMenuHandle } from './suggestion';
import { SLASH_ITEMS, type SlashItem } from './items';

vi.mock('tippy.js', () => ({
  default: vi.fn(),
}));

// `renderSlashMenu()` の onStart は `new ReactRenderer(...)` する。実際の
// EditorContent マウントなしでは ref が populate されないため、ここでは
// 生成回数だけを検証できる軽量フェイクに差し替える(Finding 1 の対象は
// component/popup 変数のライフサイクル管理であって、React の実描画では
// ないため、これで意味のある検証ができる)。
const rendererInstances: { destroy: ReturnType<typeof vi.fn> }[] = [];
vi.mock('@tiptap/react', () => {
  class FakeReactRenderer {
    element = document.createElement('div');
    ref: unknown = null;
    destroy = vi.fn();
    props: Record<string, unknown>;
    constructor(
      public component: unknown,
      options: { props?: Record<string, unknown> },
    ) {
      this.props = options.props ?? {};
      rendererInstances.push(this);
    }
    updateProps(props: Record<string, unknown>) {
      this.props = { ...this.props, ...props };
    }
  }
  return { ReactRenderer: FakeReactRenderer };
});

function makeProps(
  overrides: Partial<SuggestionProps<SlashItem, SlashItem>> = {},
): SuggestionProps<SlashItem, SlashItem> {
  return {
    editor: {} as Editor,
    range: { from: 0, to: 1 },
    query: '',
    text: '/',
    items: SLASH_ITEMS,
    command: vi.fn(),
    decorationNode: null,
    clientRect: () => new DOMRect(0, 0, 0, 0),
    ...overrides,
  };
}

describe('renderSlashMenu lifecycle (Finding 1 regression)', () => {
  beforeEach(() => {
    vi.mocked(tippy).mockReset();
    vi.mocked(tippy).mockImplementation(
      () =>
        [
          { setProps: vi.fn(), hide: vi.fn(), destroy: vi.fn() },
        ] as unknown as ReturnType<typeof tippy>,
    );
    rendererInstances.length = 0;
  });

  it('re-creates the tippy popup and React renderer after a close -> reopen cycle', () => {
    const lifecycle = renderSlashMenu?.();
    if (!lifecycle) throw new Error('renderSlashMenu() returned no lifecycle');

    // 1st session: "/" typed, menu opens.
    lifecycle.onStart?.(makeProps());
    expect(tippy).toHaveBeenCalledTimes(1);
    expect(rendererInstances).toHaveLength(1);

    // Session closes (space typed, item selected, etc.) — must fully clean up.
    lifecycle.onExit?.(makeProps());

    // 2nd session: "/" typed again in the same editor. Before the fix,
    // `popup` stayed a truthy (but destroyed) reference and `ensurePopup`
    // short-circuited, so no new tippy instance was ever created.
    lifecycle.onStart?.(makeProps());
    expect(tippy).toHaveBeenCalledTimes(2);
    expect(rendererInstances).toHaveLength(2);
  });
});

describe('SlashMenu keyboard handling (Finding 2 regression)', () => {
  afterEach(() => cleanup());

  it('consumes Enter without invoking command when there are no matching items', () => {
    const ref = createRef<SlashMenuHandle>();
    const command = vi.fn();
    render(<SlashMenu ref={ref} items={[]} command={command} />);

    const handled = ref.current?.onKeyDown({
      event: new KeyboardEvent('keydown', { key: 'Enter' }),
    });

    expect(handled).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });

  it('does not consume other keys when there are no matching items', () => {
    const ref = createRef<SlashMenuHandle>();
    render(<SlashMenu ref={ref} items={[]} command={vi.fn()} />);

    const handled = ref.current?.onKeyDown({
      event: new KeyboardEvent('keydown', { key: 'ArrowDown' }),
    });

    expect(handled).toBe(false);
  });

  it('moves selection down with Ctrl+n and up with Ctrl+p (emacs style)', async () => {
    const { act } = await import('@testing-library/react');
    const ref = createRef<SlashMenuHandle>();
    const command = vi.fn();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS} command={command} />);

    let handled: boolean | undefined;
    act(() => {
      handled = ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }),
      });
    });
    expect(handled).toBe(true);
    act(() => {
      ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'Enter' }),
      });
    });
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[1]);

    command.mockClear();
    act(() => {
      // from index 1: Ctrl+p twice wraps to the last item
      ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }),
      });
      ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }),
      });
    });
    act(() => {
      ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'Enter' }),
      });
    });
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[SLASH_ITEMS.length - 1]);
  });

  it('does not treat plain n/p (without Ctrl) as navigation', async () => {
    const { act } = await import('@testing-library/react');
    const ref = createRef<SlashMenuHandle>();
    const command = vi.fn();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS} command={command} />);

    let handled: boolean | undefined;
    act(() => {
      handled = ref.current?.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'n' }),
      });
    });
    expect(handled).toBe(false);
  });

  it('still selects the highlighted item on Enter when there are matches', () => {
    const ref = createRef<SlashMenuHandle>();
    const command = vi.fn();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS} command={command} />);

    const handled = ref.current?.onKeyDown({
      event: new KeyboardEvent('keydown', { key: 'Enter' }),
    });

    expect(handled).toBe(true);
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[0]);
  });
});
