// Minimal ambient declarations for the File System Access API surface used by
// FileController. lib.dom does not (yet) ship these types in this project's
// TypeScript/lib configuration, so only the methods actually consumed here
// are declared.

interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemFileHandle {
  getFile(): Promise<{ lastModified: number }>;
  createWritable(): Promise<FileSystemWritableFileStream>;
  /**
   * IndexedDB から復元したハンドルの権限を確認・要求するために使う
   * (`handle-store.ts` / `controller.ts`)。`requestPermission` は
   * ユーザージェスチャの中でしか通らないため、`Cmd+S` の処理から呼ぶ。
   */
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<FileSystemPermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<FileSystemPermissionState>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  /** Chrome remembers the last-used directory per (origin, id). */
  id?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface Window {
  showSaveFilePicker(
    options?: SaveFilePickerOptions,
  ): Promise<FileSystemFileHandle>;
}
