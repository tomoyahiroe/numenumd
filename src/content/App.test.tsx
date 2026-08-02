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

  it('saves via Cmd+S and clears dirty on success (also covers: the ProseMirror-level handleKeyDown handling does not double-route to the document-level Cmd+S listener when the event bubbles, since save is asserted to have been called exactly once — Finding 2 guard)', async () => {
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

  it('keeps dirty if the user edits again while save() is still in flight, and the next Cmd+S saves the new edit (Finding 1)', async () => {
    let resolveSave: (v: 'saved') => void = () => {};
    const savePromise = new Promise<'saved'>((resolve) => {
      resolveSave = resolve;
    });
    const save = vi.fn(() => savePromise);
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    act(() => pressCmdS());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // 保存の await 中(まだ fc.save が resolve していない)にさらに編集する。
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('z');
    });

    // ここで保存が完了する。
    await act(async () => {
      resolveSave('saved');
      await savePromise;
    });

    // 保存が完了した内容には、直後の編集が反映されていない。
    // dirty を落としてしまうと、その編集はメモリにしか残らず
    // タブを閉じれば警告なく消えてしまう(無警告データロス)ので、
    // dirty は維持されなければならない。
    expect(screen.getByTestId('dirty-dot')).toBeTruthy();

    // 次の Cmd+S で、取りこぼされていた編集が改めて保存される。
    act(() => pressCmdS());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('dirty-dot')).toBeNull());
  });

  it('routes Cmd+S even when focus is outside the editor, e.g. after clicking the header (Finding 2)', async () => {
    const save = vi.fn(async () => 'saved' as const);
    mockFileController({ save });
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => expect(window.__numenumdEditor__).toBeTruthy());
    act(() => {
      window.__numenumdEditor__!.commands.insertContent('y');
    });
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();

    // フォーカスをエディタの外(ヘッダ・ガター等)へ移す。KeyRouter は
    // ProseMirror の handleKeyDown 経由でしか届かないため、フォーカスが
    // エディタに無い状態の Cmd+S はこの document レベルのフォールバックが
    // 無いと素通しし、Chrome の「ページを保存」ダイアログが開いてしまう。
    document.body.focus();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

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

describe('theme toggle (UX feedback)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.numenumdTheme;
    vi.unstubAllGlobals();
  });

  const stubMatchMedia = (prefersDark: boolean) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('dark') ? prefersDark : !prefersDark,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  };

  it('defaults to the OS preference (dark) and stamps it on the document root', async () => {
    stubMatchMedia(true);
    render(<App rawMarkdown={'x'} filename="note.md" />);
    await waitFor(() => {
      expect(document.documentElement.dataset.numenumdTheme).toBe('dark');
    });
    expect(screen.getByTestId('theme-toggle').textContent).toContain('Auto');
  });

  it('clicking the toggle cycles auto -> light -> dark -> auto', async () => {
    stubMatchMedia(true);
    render(<App rawMarkdown={'x'} filename="note.md" />);
    const btn = await screen.findByTestId('theme-toggle');

    act(() => {
      btn.click();
    });
    expect(document.documentElement.dataset.numenumdTheme).toBe('light');
    expect(btn.textContent).toContain('Light');

    act(() => {
      btn.click();
    });
    expect(document.documentElement.dataset.numenumdTheme).toBe('dark');
    expect(btn.textContent).toContain('Dark');

    act(() => {
      btn.click();
    });
    // back to auto: OS is dark in this test
    expect(document.documentElement.dataset.numenumdTheme).toBe('dark');
    expect(btn.textContent).toContain('Auto');
  });
});
