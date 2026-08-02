import { describe, it, expect } from 'vitest';
import { resolveTheme, nextPreference } from './theme';

describe('theme', () => {
  it('auto resolves from the OS preference', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('explicit preferences override the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('toggle cycles auto -> light -> dark -> auto', () => {
    expect(nextPreference('auto')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('auto');
  });
});
