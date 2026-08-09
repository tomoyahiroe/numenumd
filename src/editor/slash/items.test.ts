import { describe, it, expect } from 'vitest';
import { SLASH_ITEMS, filterSlashItems } from './items';

describe('slash items', () => {
  it('includes all MVP block types', () => {
    const titles = SLASH_ITEMS.map((i) => i.title);
    for (const t of [
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'To-do list',
      'Quote',
      'Code block',
      'Math block',
      'Table',
    ]) {
      expect(titles).toContain(t);
    }
  });

  it('filters by title prefix and keywords, case-insensitive', () => {
    expect(filterSlashItems('head').length).toBe(3);
    expect(filterSlashItems('HEAD').length).toBe(3);
    expect(filterSlashItems('todo').map((i) => i.title)).toEqual([
      'To-do list',
    ]);
    expect(filterSlashItems('数式').map((i) => i.title)).toEqual([
      'Math block',
    ]);
    expect(filterSlashItems('テーブル').map((i) => i.title)).toEqual(['Table']);
  });

  it('returns all items for empty query', () => {
    expect(filterSlashItems('')).toEqual(SLASH_ITEMS);
  });
});
