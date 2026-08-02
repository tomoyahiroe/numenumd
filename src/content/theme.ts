export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(
  pref: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (pref === 'auto') return prefersDark ? 'dark' : 'light';
  return pref;
}

export function nextPreference(pref: ThemePreference): ThemePreference {
  if (pref === 'auto') return 'light';
  if (pref === 'light') return 'dark';
  return 'auto';
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};
