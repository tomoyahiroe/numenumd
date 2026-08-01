export type SaveResult = 'saved' | 'cancelled' | 'conflict';

/**
 * Manages persistence of a single Markdown document to local disk via the
 * File System Access API.
 *
 * - The file picker is shown at most once per instance (first successful
 *   `save()`); subsequent saves reuse the in-memory handle.
 * - No state survives a page/session reload — this class holds the handle
 *   only in memory, by design.
 * - Before overwriting, `save()` compares the on-disk `lastModified` against
 *   the mtime recorded after our last successful write. If the file changed
 *   externally in the meantime, it refuses to write and returns `'conflict'`
 *   so the caller can prompt the user; `confirmOverwrite()` performs the
 *   forced write once the user accepts losing the external change.
 * - If the OS/browser revokes write permission (`NotAllowedError`), the
 *   handle is discarded so the *next* `save()` call re-prompts the picker
 *   instead of silently failing forever. The failed attempt itself reports
 *   `'cancelled'` and writes nothing — the caller's in-memory content is
 *   never touched, so no data is lost.
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
  ) {}

  async save(markdown: string): Promise<SaveResult> {
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
    return 'saved';
  }
}
