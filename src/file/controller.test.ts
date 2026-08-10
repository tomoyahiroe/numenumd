// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileController } from './controller';
import { createFakeHandleStore } from './handle-store.fake';

function mockHandle(
  initialMtime: number,
  permission: 'granted' | 'denied' | 'prompt' = 'granted',
) {
  let mtime = initialMtime;
  const written: string[] = [];
  const handle = {
    getFile: vi.fn(async () => ({ lastModified: mtime })),
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    createWritable: vi.fn(async () => ({
      write: vi.fn(async (data: string) => {
        written.push(data);
        mtime += 1;
      }),
      close: vi.fn(async () => {}),
    })),
  };
  return {
    handle,
    written,
    bumpMtime: () => {
      mtime += 100;
    },
  };
}

describe('FileController', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('opens picker on first save, then saves silently', async () => {
    const { handle, written } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('note.md');
    expect(await fc.save('# a\n')).toBe('saved');
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'note.md' }),
    );
    expect(await fc.save('# b\n')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['# a\n', '# b\n']);
  });

  it('returns cancelled when user dismisses picker', async () => {
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => {
        throw new DOMException('user cancelled', 'AbortError');
      }),
    );
    expect(await new FileController('n.md').save('x')).toBe('cancelled');
  });

  it('detects external modification and refuses to overwrite', async () => {
    const { handle, bumpMtime, written } = mockHandle(1000);
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => handle),
    );
    const fc = new FileController('n.md');
    await fc.save('v1');
    bumpMtime(); // 他アプリがファイルを変更
    expect(await fc.save('v2')).toBe('conflict');
    expect(written).toEqual(['v1']);
    expect(await fc.confirmOverwrite('v2')).toBe('saved');
    expect(written).toEqual(['v1', 'v2']);
  });

  it('re-prompts picker when permission was revoked', async () => {
    // 実装仕様: write 中に NotAllowedError が発生した場合、FileController は
    // handle を破棄して 'cancelled' を返す(空内容での上書きを避けるため、
    // その場で再ピッカーはせず呼び出し側に委ねる)。次回の save で新しい
    // ピッカーが表示され、そこで初めて保存が成立する。
    const { handle } = mockHandle(1000);
    const fresh = mockHandle(2000);
    handle.createWritable = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('n.md');
    // 初回: handle 取得後 write で NotAllowedError → 'cancelled' で戻る
    expect(await fc.save('v1')).toBe('cancelled');
    picker.mockImplementation(async () => fresh.handle);
    // 2回目: handle が破棄されているので再度ピッカーが開き、新ハンドルで保存成功
    expect(await fc.save('v1')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(2);
    expect(fresh.written).toEqual(['v1']);
  });
});

describe('FileController picker directory memory (UX feedback)', () => {
  it('passes a stable picker id so Chrome reopens the last-used directory', async () => {
    const { handle } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('note.md', 'd_notesdir');
    await fc.save('# a\n');
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'note.md', id: 'd_notesdir' }),
    );
  });

  it('omits id when none is provided (backwards compatible)', async () => {
    const { handle } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('note.md');
    await fc.save('x');
    const call = (picker.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect('id' in call).toBe(false);
  });
});

// 保存先の記憶(spec「保存先の記憶」節)。リロードのたびにピッカーを出す
// 従来動作を、記憶があるときだけ省略する。記憶まわりで何が起きても
// 「従来どおりピッカーが出る」以上に悪くならないことを固定する。
describe('FileController remembering the save target', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const remembered = (handle: FileSystemFileHandle, mtime: number | null) =>
    createFakeHandleStore({ '/notes/a.md': { handle, lastSavedMtime: mtime } });

  it('saves without opening the picker when a granted handle is remembered', async () => {
    const { handle, written } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const store = remembered(handle as unknown as FileSystemFileHandle, 1000);

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('saved');
    expect(picker).not.toHaveBeenCalled();
    expect(written).toEqual(['v1']);
  });

  it('asks for permission when the remembered handle is in the prompt state', async () => {
    const { handle } = mockHandle(1000, 'prompt');
    handle.requestPermission = vi.fn(async () => 'granted' as const);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const store = remembered(handle as unknown as FileSystemFileHandle, 1000);

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('saved');
    expect(handle.requestPermission).toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
  });

  it('falls back to the picker when permission is refused, and re-remembers', async () => {
    const stale = mockHandle(1000, 'denied');
    const fresh = mockHandle(2000);
    const picker = vi.fn(async () => fresh.handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const store = remembered(
      stale.handle as unknown as FileSystemFileHandle,
      1000,
    );

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(fresh.written).toEqual(['v1']);
    // 記憶はピッカーで選ばれた方に置き換わる。
    expect((await store.get('/notes/a.md'))?.handle).toBe(fresh.handle);
  });

  it('falls back to the picker when the remembered file no longer exists', async () => {
    const gone = mockHandle(1000);
    gone.handle.getFile = vi.fn(async () => {
      throw new DOMException('missing', 'NotFoundError');
    });
    const fresh = mockHandle(2000);
    const picker = vi.fn(async () => fresh.handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const store = remembered(
      gone.handle as unknown as FileSystemFileHandle,
      1000,
    );

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(fresh.written).toEqual(['v1']);
  });

  it('remembers the target after the first successful save', async () => {
    const { handle } = mockHandle(1000);
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => handle),
    );
    const store = createFakeHandleStore();

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await store.count()).toBe(0);
    await fc.save('v1');
    expect(await store.count()).toBe(1);
    expect((await store.get('/notes/a.md'))?.handle).toBe(handle);
  });

  it('does not remember anything when the save failed', async () => {
    const { handle } = mockHandle(1000);
    handle.createWritable = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => handle),
    );
    const store = createFakeHandleStore();

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('cancelled');
    expect(await store.count()).toBe(0);
  });

  // 従来はリロード後の初回保存で `lastSavedMtime` が null になり、外部変更の
  // チェックを丸ごと飛ばして黙って上書きしていた。記憶と一緒に mtime を
  // 持つことでこの穴が塞がる。
  it('detects an external change on the first save after a reload', async () => {
    const { handle, bumpMtime, written } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const store = remembered(handle as unknown as FileSystemFileHandle, 1000);

    bumpMtime(); // numenumd を開いていない間に他アプリが書き換えた

    const fc = new FileController('a.md', undefined, {
      path: '/notes/a.md',
      store,
    });
    expect(await fc.save('v1')).toBe('conflict');
    expect(written).toEqual([]);
    expect(picker).not.toHaveBeenCalled();

    expect(await fc.confirmOverwrite('v1')).toBe('saved');
    expect(written).toEqual(['v1']);
  });

  it('still works when no store is configured (unchanged behaviour)', async () => {
    const { handle, written } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);

    const fc = new FileController('a.md');
    expect(await fc.save('v1')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['v1']);
  });
});
