import type { HandleStore } from './handle-store';

export type SaveResult = 'saved' | 'cancelled' | 'conflict';

/** 保存先を記憶するための設定。省略するとタブ内メモリのみの従来動作になる。 */
export type RememberOptions = {
  /** 記憶のキー。ファイルのパス(`location.pathname`)。 */
  path: string;
  store: HandleStore;
};

/**
 * Manages persistence of a single Markdown document to local disk via the
 * File System Access API.
 *
 * - The file picker is shown at most once per instance (first successful
 *   `save()`); subsequent saves reuse the in-memory handle.
 * - When `remember` is supplied, the handle and the last-saved mtime are also
 *   persisted (see `handle-store.ts`), so a reloaded tab can save without
 *   asking the user to pick the file again. That store is the only persistent
 *   data numenumd itself reads or writes — the browser separately retains the
 *   picker's last-used directory and the File System Access grant, neither of
 *   which numenumd can read. See the spec's 「保存先の記憶」 section.
 *   Remembering is strictly best-effort: any failure falls back to the picker,
 *   which is the pre-existing behaviour.
 * - Before overwriting, `save()` compares the on-disk `lastModified` against
 *   the mtime recorded after our last successful write. If the file changed
 *   externally in the meantime, it refuses to write and returns `'conflict'`
 *   so the caller can prompt the user; `confirmOverwrite()` performs the
 *   forced write once the user accepts losing the external change.
 * - If the OS/browser revokes write permission (`NotAllowedError`), the
 *   in-memory handle is discarded so the *next* `save()` call starts over
 *   instead of silently failing forever. With `remember` configured that
 *   restart goes through the store first — it re-requests permission on the
 *   remembered handle and only falls back to the picker if that is refused.
 *   The failed attempt itself reports `'cancelled'` and writes nothing — the
 *   caller's in-memory content is never touched, so no data is lost.
 */
export class FileController {
  private handle: FileSystemFileHandle | null = null;
  private lastSavedMtime: number | null = null;

  constructor(
    private readonly suggestedName: string,
    // showSaveFilePicker の id。Chrome は (origin, id) ごとに最後に使った
    // ディレクトリを記憶するため、フォルダ由来の id を渡すと2回目以降の
    // ピッカーが Download ではなく前回のフォルダで開く。
    private readonly pickerId?: string,
    private readonly remember?: RememberOptions,
  ) {}

  /**
   * 記憶した保存先を復元する。成功したらハンドルと最終保存時刻を復元し、
   * 失敗したら**何もしない**(呼び出し側はピッカーへ落ちる)。
   *
   * 権限は `requestPermission` で求め直す。Chrome 122 以降、IndexedDB から
   * 取り出したハンドルに対するこの呼び出しはファイルピッカーではなく三択の
   * 許可プロンプトになる。ユーザージェスチャの中でしか通らないので、
   * `Cmd+S` の処理から呼ばれるこの経路に置いている。
   */
  private async restoreRemembered(): Promise<void> {
    if (!this.remember) return;

    let remembered;
    try {
      remembered = await this.remember.store.get(this.remember.path);
    } catch {
      return;
    }
    if (!remembered) return;

    const { handle } = remembered;
    if (
      typeof handle.queryPermission !== 'function' ||
      typeof handle.requestPermission !== 'function'
    ) {
      // 権限を確認する手段が無いなら、書けるかどうか分からないまま使わない。
      return;
    }

    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (permission !== 'granted') return;
      // 移動・削除されていれば NotFoundError。ここで気づけば、書き込み時に
      // 失敗する代わりにピッカーへ落とせる。
      await handle.getFile();
    } catch {
      return;
    }

    this.handle = handle;
    this.lastSavedMtime = remembered.lastSavedMtime;
  }

  /** 保存に成功した保存先だけを記憶する。失敗しても保存自体は成功扱いのまま。 */
  private async rememberCurrent(): Promise<void> {
    if (!this.remember || !this.handle) return;
    try {
      await this.remember.store.put(this.remember.path, {
        handle: this.handle,
        lastSavedMtime: this.lastSavedMtime,
      });
    } catch {
      // 記憶できないのは機能低下であって保存の失敗ではない。握り潰す。
    }
  }

  async save(markdown: string): Promise<SaveResult> {
    if (!this.handle) await this.restoreRemembered();
    if (!this.handle) {
      try {
        this.handle = await window.showSaveFilePicker({
          suggestedName: this.suggestedName,
          ...(this.pickerId !== undefined && { id: this.pickerId }),
          types: [
            { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
          ],
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return 'cancelled';
        }
        throw e;
      }
    } else if (this.lastSavedMtime !== null) {
      const file = await this.handle.getFile();
      if (file.lastModified > this.lastSavedMtime) {
        return 'conflict';
      }
    }
    return this.write(markdown);
  }

  async confirmOverwrite(markdown: string): Promise<SaveResult> {
    return this.write(markdown);
  }

  private async write(markdown: string): Promise<SaveResult> {
    if (!this.handle) return this.save(markdown);
    try {
      const writable = await this.handle.createWritable();
      await writable.write(markdown);
      await writable.close();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        // Permission was revoked. Nothing was written (write() throws before
        // any bytes land in this failure mode), so the user's content is
        // safe. Discard the stale handle so the next save() re-prompts.
        this.handle = null;
        this.lastSavedMtime = null;
        return 'cancelled';
      }
      throw e;
    }
    this.lastSavedMtime = (await this.handle.getFile()).lastModified;
    await this.rememberCurrent();
    return 'saved';
  }
}
