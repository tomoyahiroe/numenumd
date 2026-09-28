/**
 * Pure helpers for the editor's image preview (src/editor/image-preview.ts):
 * reading one image span's source, collecting `[ref]: dest` definitions, and
 * deciding whether a destination is a local file that may be displayed.
 *
 * Nothing here touches the document or the saved Markdown. Image syntax stays
 * verbatim text (see verbatim-spans.ts); this only interprets it for display.
 */

export type ImageSource =
  | { kind: 'inline'; alt: string; dest: string; title: string | null }
  | { kind: 'reference'; alt: string; label: string };

export type RefDefinition = { dest: string; title: string | null };

export type ResolvedImage =
  { kind: 'local'; url: string } | { kind: 'remote' } | { kind: 'unsupported' };

const unescape = (s: string): string => s.replace(/\\([!-/:-@[-`{-~])/g, '$1');

/** Index just past the `]` that closes the `[` at `open`, or -1. */
function closeBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i + 1;
  }
  return -1;
}

function stripTitle(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2) return null;
  const pairs: Record<string, string> = { '"': '"', "'": "'", '(': ')' };
  const close = pairs[t[0]!];
  return close !== undefined && t.endsWith(close)
    ? unescape(t.slice(1, -1))
    : null;
}

/** Splits `dest "title"` / `<dest> "title"` into its parts. */
function splitDestAndTitle(inner: string): {
  dest: string;
  title: string | null;
} {
  const t = inner.trim();
  if (t.startsWith('<')) {
    const end = t.indexOf('>');
    if (end === -1) return { dest: unescape(t), title: null };
    return {
      dest: unescape(t.slice(1, end)),
      title: stripTitle(t.slice(end + 1)),
    };
  }
  const m = /^(\S*)([\s\S]*)$/.exec(t)!;
  return { dest: unescape(m[1]!), title: stripTitle(m[2]!) };
}

export function parseImageSpan(src: string): ImageSource | null {
  if (!src.startsWith('![')) return null;
  const afterLabel = closeBracket(src, 1);
  if (afterLabel === -1 || afterLabel >= src.length) return null;
  const rawAlt = src.slice(2, afterLabel - 1);
  const alt = unescape(rawAlt);
  const rest = src.slice(afterLabel);
  if (rest.startsWith('(') && rest.endsWith(')')) {
    return { kind: 'inline', alt, ...splitDestAndTitle(rest.slice(1, -1)) };
  }
  if (rest.startsWith('[') && rest.endsWith(']')) {
    const label = rest.slice(1, -1);
    return {
      kind: 'reference',
      alt,
      label: label.trim() === '' ? rawAlt : label,
    };
  }
  return null;
}

export function normalizeRefLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

const DEFINITION = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(.+)$/;

export function parseRefDefinitions(
  content: string,
): Map<string, RefDefinition> {
  const defs = new Map<string, RefDefinition>();
  for (const line of content.split('\n')) {
    const m = DEFINITION.exec(line);
    if (!m) continue;
    const key = normalizeRefLabel(m[1]!);
    if (key === '' || defs.has(key)) continue;
    defs.set(key, splitDestAndTitle(m[2]!));
  }
  return defs;
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

export function resolveImageDest(dest: string, pageUrl: string): ResolvedImage {
  const t = dest.trim();
  if (t === '') return { kind: 'unsupported' };
  try {
    if (t.startsWith('//')) return { kind: 'remote' };
    if (/^[A-Za-z]:[\\/]/.test(t)) {
      return {
        kind: 'local',
        url: new URL('file:///' + t.replace(/\\/g, '/')).href,
      };
    }
    const scheme = SCHEME.exec(t)?.[1]?.toLowerCase();
    if (scheme !== undefined) {
      if (scheme === 'http' || scheme === 'https') return { kind: 'remote' };
      if (scheme === 'file') return { kind: 'local', url: new URL(t).href };
      if (scheme === 'data' && /^data:image\//i.test(t)) {
        return { kind: 'local', url: t };
      }
      return { kind: 'unsupported' };
    }
    if (t.startsWith('/')) {
      return { kind: 'local', url: new URL(t, 'file:///').href };
    }
    if (new URL(pageUrl).protocol !== 'file:') return { kind: 'unsupported' };
    return { kind: 'local', url: new URL(t, pageUrl).href };
  } catch {
    return { kind: 'unsupported' };
  }
}
