/**
 * Derives a stable `showSaveFilePicker` id from a file path's directory.
 *
 * Chrome remembers the last-used directory per (origin, id), so keying the id
 * on the directory makes the save picker reopen where files from that folder
 * were last saved, instead of defaulting to Downloads every time. Chrome
 * requires ids to be at most 32 chars of [A-Za-z0-9_-], so the path is
 * djb2-hashed rather than embedded.
 */
export function pickerIdForPath(path: string): string {
  const dir = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  let hash = 5381;
  for (let i = 0; i < dir.length; i++) {
    hash = ((hash << 5) + hash + dir.charCodeAt(i)) >>> 0;
  }
  return 'd' + hash.toString(36);
}
