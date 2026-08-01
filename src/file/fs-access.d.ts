// Minimal ambient declarations for the File System Access API surface used by
// FileController. lib.dom does not (yet) ship these types in this project's
// TypeScript/lib configuration, so only the methods actually consumed here
// are declared.

interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  getFile(): Promise<{ lastModified: number }>;
  createWritable(): Promise<FileSystemWritableFileStream>;
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
