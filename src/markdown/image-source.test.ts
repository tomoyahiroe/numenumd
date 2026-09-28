import { describe, it, expect } from 'vitest';
import {
  parseImageSpan,
  normalizeRefLabel,
  parseRefDefinitions,
  resolveImageDest,
} from './image-source';

const PAGE = 'file:///Users/me/notes/doc.md';

describe('parseImageSpan', () => {
  it('parses an inline image', () => {
    expect(parseImageSpan('![a cat](img/cat.png)')).toEqual({
      kind: 'inline',
      alt: 'a cat',
      dest: 'img/cat.png',
      title: null,
    });
  });
  it('parses a title in double quotes, single quotes and parentheses', () => {
    expect(parseImageSpan('![a](x.png "T 1")')).toMatchObject({
      dest: 'x.png',
      title: 'T 1',
    });
    expect(parseImageSpan("![a](x.png 'T')")).toMatchObject({ title: 'T' });
    expect(parseImageSpan('![a](x.png (T))')).toMatchObject({ title: 'T' });
  });
  it('parses an angle-bracket destination with spaces', () => {
    expect(parseImageSpan('![a](<my pics/c d.png> "t")')).toMatchObject({
      dest: 'my pics/c d.png',
      title: 't',
    });
  });
  it('unescapes backslash escapes in alt and dest', () => {
    expect(parseImageSpan('![a \\[1\\]](x\\(1\\).png)')).toMatchObject({
      alt: 'a [1]',
      dest: 'x(1).png',
    });
  });
  it('parses full and collapsed reference forms', () => {
    expect(parseImageSpan('![alt][Ref One]')).toEqual({
      kind: 'reference',
      alt: 'alt',
      label: 'Ref One',
    });
    expect(parseImageSpan('![Logo][]')).toEqual({
      kind: 'reference',
      alt: 'Logo',
      label: 'Logo',
    });
  });
  it('returns null for text that is not an image span', () => {
    expect(parseImageSpan('[a](b)')).toBeNull();
    expect(parseImageSpan('![a]')).toBeNull();
  });
});

describe('reference definitions', () => {
  it('normalizes labels case-insensitively and collapses whitespace', () => {
    expect(normalizeRefLabel('  Ref   One ')).toBe('ref one');
  });
  it('parses definitions, including <…> destinations and titles', () => {
    const defs = parseRefDefinitions(
      '[Img Ref]: pics/a.png "T"\n[other]: <b c.png>',
    );
    expect(defs.get('img ref')).toEqual({ dest: 'pics/a.png', title: 'T' });
    expect(defs.get('other')).toEqual({ dest: 'b c.png', title: null });
  });
  it('keeps the first definition for a repeated label', () => {
    expect(parseRefDefinitions('[a]: 1.png\n[A]: 2.png').get('a')?.dest).toBe(
      '1.png',
    );
  });
  it('ignores footnote definitions and non-definition lines', () => {
    expect(parseRefDefinitions('[^1]: note\n<div>x</div>').size).toBe(0);
  });
});

describe('resolveImageDest', () => {
  it.each([
    ['img/cat.png', 'file:///Users/me/notes/img/cat.png'],
    ['../pics/a.png', 'file:///Users/me/pics/a.png'],
    ['my pics/c d.png', 'file:///Users/me/notes/my%20pics/c%20d.png'],
    ['/Users/me/a.png', 'file:///Users/me/a.png'],
    ['C:\\x\\a.png', 'file:///C:/x/a.png'],
    ['C:/x/a.png', 'file:///C:/x/a.png'],
    ['file:///tmp/a.png', 'file:///tmp/a.png'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
  ])('%s is local', (dest, url) => {
    expect(resolveImageDest(dest, PAGE)).toEqual({ kind: 'local', url });
  });

  it.each([
    'https://example.com/a.png',
    'http://example.com/a.png',
    '//example.com/a.png',
    'HTTPS://X/A.PNG',
  ])('%s is remote', (dest) => {
    expect(resolveImageDest(dest, PAGE)).toEqual({ kind: 'remote' });
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'chrome://settings',
    'blob:x',
    'data:text/html,<b>x</b>',
  ])('%j is unsupported', (dest) => {
    expect(resolveImageDest(dest, PAGE)).toEqual({ kind: 'unsupported' });
  });

  it('treats relative paths as unsupported when the page is not a file: URL', () => {
    expect(resolveImageDest('img/cat.png', 'http://localhost/doc.md')).toEqual({
      kind: 'unsupported',
    });
  });
});
