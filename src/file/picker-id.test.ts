import { describe, it, expect } from 'vitest';
import { pickerIdForPath } from './picker-id';

describe('pickerIdForPath', () => {
  it('is deterministic and depends on the directory, not the filename', () => {
    const a = pickerIdForPath('/Users/x/notes/a.md');
    const b = pickerIdForPath('/Users/x/notes/b.md');
    const other = pickerIdForPath('/Users/x/journal/a.md');
    expect(a).toBe(pickerIdForPath('/Users/x/notes/a.md'));
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it('produces ids Chrome accepts (max 32 chars, [A-Za-z0-9_-])', () => {
    for (const p of [
      '/Users/x/notes/a.md',
      '/日本語/パス/メモ.md',
      '/a b/c d/e.md',
      '/',
      '',
    ]) {
      expect(pickerIdForPath(p)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    }
  });
});
