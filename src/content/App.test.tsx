// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { App } from './App';
import { FileController } from '../file/controller';
// Editor.tsx が `declare global { interface Window { __numenumdEditor__ } }`
// を宣言しているため、window.__numenumdEditor__ はここでも型付きで使える。
import '../editor/Editor';

// FileController は class(new で呼ばれる)なので、モック実装はアロー関数
// ではなく通常の function にする必要がある。アロー関数を vi.fn() 経由で
// `new` すると「is not a constructor」で落ちる(実際に TDD の Red で確認済み)。
vi.mock('../file/controller', () => ({
  FileController: vi.fn(function () {
    return { save: vi.fn(async () => 'saved') };
  }),
}));

function mockFileController(overrides: {
  save: (md: string) => Promise<'saved' | 'cancelled' | 'conflict'>;
  confirmOverwrite?: (
    md: string,
  ) => Promise<'saved' | 'cancelled' | 'conflict'>;
}) {
  const impl = function () {
    return {
      save: overrides.save,
      confirmOverwrite: overrides.confirmOverwrite ?? vi.fn(),
    };
  } as unknown as (suggestedName: string) => FileController;
  vi.mocked(FileController).mockImplementationOnce(impl);
}

function pressCmdS() {
  const dom = document.querySelector('.ProseMirror');
  if (!dom) throw new Error('editor dom not mounted');
  dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  cleanup();
  delete window.__numenumdEditor__;
});

describe('App', () => {
  it('renders editor from raw markdown and shows filename', async () => {
    render(<App rawMarkdown={'# Title'} filename="note.md" />);
    expect(await screen.findByText('Title')).toBeTruthy();
    expect(screen.getByText('note.md')).toBeTruthy();
  });

  it('shows dirty indicator after edit and clears after save', async () => {
    render(<App rawMarkdown={'x'} filename="note.md" />);
    expect(screen.queryByTestId('dirty-dot')).toBeNull();
    // 編集(テスト用グローバル editor 経由)→ dirty 表示
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();
  });

  it('saves via Cmd+S and clears dirty on success', async () => {
    const save = vi.fn(async () => 'saved' as const);
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    act(() => pressCmdS());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('dirty-dot')).toBeNull());
  });

  it('does nothing on Cmd+S when not dirty (no save call)', async () => {
    const save = vi.fn(async () => 'saved' as const);
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());

    act(() => pressCmdS());

    // dirty ではないので save は呼ばれない
    await new Promise((r) => setTimeout(r, 0));
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps dirty and shows a failure toast when save rejects (no silent data loss)', async () => {
    const save = vi.fn(async (): Promise<'saved'> => {
      throw new Error('disk full');
    });
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    act(() => pressCmdS());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // 保存失敗が沈黙しない: トーストが出て、dirty も維持される
    expect(await screen.findByText(/保存に失敗/)).toBeTruthy();
    expect(screen.getByTestId('dirty-dot')).toBeTruthy();
  });

  it('re-arms dirty correctly across edit -> save -> edit', async () => {
    const save = vi.fn(async () => 'saved' as const);
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());

    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    act(() => pressCmdS());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('dirty-dot')).toBeNull());

    act(() => {
      window.__numenumdEditor__!.commands.insertContent('z');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    act(() => pressCmdS());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('dirty-dot')).toBeNull());
  });
});
