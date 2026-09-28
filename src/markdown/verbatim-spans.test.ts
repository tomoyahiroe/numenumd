import { describe, it, expect } from 'vitest';
import {
  findImageSpans,
  findVerbatimSpans,
  matchFootnoteMarkerAt,
  matchImageSpanAt,
} from './verbatim-spans';

/** `findVerbatimSpans` の結果を、対象文字列の実体に戻して見やすくする。 */
function spanTexts(str: string): string[] {
  return findVerbatimSpans(str).map(([s, e]) => str.slice(s, e));
}

describe('matchImageSpanAt', () => {
  it('matches the inline form', () => {
    const s = '![alt](a.png)';
    expect(matchImageSpanAt(s, 0)).toBe(s.length);
  });

  it('matches the inline form with a title', () => {
    const s = '![alt](a.png "Cap")';
    expect(matchImageSpanAt(s, 0)).toBe(s.length);
  });

  it('matches the reference and collapsed reference forms', () => {
    expect(matchImageSpanAt('![alt][ref]', 0)).toBe(11);
    expect(matchImageSpanAt('![alt][]', 0)).toBe(8);
  });

  it('matches when embedded in surrounding prose', () => {
    const s = 'see ![alt](a.png) here';
    expect(matchImageSpanAt(s, 4)).toBe(17);
    expect(s.slice(4, 17)).toBe('![alt](a.png)');
  });

  it('handles nested brackets in the label and parens in the target', () => {
    expect(matchImageSpanAt('![a[b]c](url)', 0)).toBe(13);
    expect(matchImageSpanAt('![a](u(v)w)', 0)).toBe(11);
  });

  it('does not treat escaped delimiters as the closer', () => {
    const s = '![a\\]b](u)';
    expect(matchImageSpanAt(s, 0)).toBe(s.length);
  });

  it('rejects a plain link so ordinary [t](u) prose keeps being escaped', () => {
    expect(matchImageSpanAt('[t](u)', 0)).toBeNull();
    expect(findVerbatimSpans('see [t](u) here')).toEqual([]);
  });

  it('rejects the shortcut form and unterminated / multi-line forms', () => {
    expect(matchImageSpanAt('![alt]', 0)).toBeNull();
    expect(matchImageSpanAt('![alt](a.png', 0)).toBeNull();
    expect(matchImageSpanAt('![alt\n](a.png)', 0)).toBeNull();
    expect(matchImageSpanAt('![alt](a\n.png)', 0)).toBeNull();
    expect(matchImageSpanAt('!not-an-image', 0)).toBeNull();
  });

  it('honours the len bound (markdown-it の state.posMax 相当)', () => {
    const s = '![alt](a.png)';
    expect(matchImageSpanAt(s, 0, 6)).toBeNull();
  });
});

describe('matchFootnoteMarkerAt', () => {
  it('matches numeric and named markers', () => {
    expect(matchFootnoteMarkerAt('[^1]', 0)).toBe(4);
    expect(matchFootnoteMarkerAt('[^my-note]', 0)).toBe(10);
  });

  it('matches when embedded in prose', () => {
    const s = 'text[^1] more';
    expect(matchFootnoteMarkerAt(s, 4)).toBe(8);
  });

  it('rejects an empty label, whitespace labels and unterminated markers', () => {
    expect(matchFootnoteMarkerAt('[^]', 0)).toBeNull();
    expect(matchFootnoteMarkerAt('[^my note]', 0)).toBeNull();
    expect(matchFootnoteMarkerAt('[^1\n]', 0)).toBeNull();
    expect(matchFootnoteMarkerAt('[^1', 0)).toBeNull();
    expect(matchFootnoteMarkerAt('[^a[b]]', 0)).toBeNull();
  });

  it('rejects ordinary brackets (地の文の array[0] は従来どおり)', () => {
    expect(matchFootnoteMarkerAt('[0]', 0)).toBeNull();
    expect(matchFootnoteMarkerAt('[ref]', 0)).toBeNull();
    expect(findVerbatimSpans('array[0] and [ref]')).toEqual([]);
  });
});

describe('findVerbatimSpans', () => {
  it('collects math, image and footnote spans in one pass', () => {
    const s = 'math $x_{i}$ img ![a](b.png) note[^1] end';
    expect(spanTexts(s)).toEqual(['$x_{i}$', '![a](b.png)', '[^1]']);
  });

  it('does not resume scanning inside an already matched span', () => {
    // 画像の中の `[` を脚注として二重に拾わないこと。
    expect(spanTexts('![a][^x]')).toEqual(['![a][^x]']);
  });

  it('still excludes prose dollar amounts (math-spans のヒューリスティック)', () => {
    expect(findVerbatimSpans('The price is $5 and $10 today.')).toEqual([]);
  });

  it('returns an empty list for text with nothing to protect', () => {
    expect(findVerbatimSpans('')).toEqual([]);
    expect(findVerbatimSpans('plain prose, no markup')).toEqual([]);
  });
});

describe('findImageSpans', () => {
  it('returns only image spans, in order', () => {
    const s = 'a ![x](x.png) [^1] $y$ ![z][ref] b';
    expect(findImageSpans(s).map(([f, t]) => s.slice(f, t))).toEqual([
      '![x](x.png)',
      '![z][ref]',
    ]);
  });

  it('ignores image-like text inside inline math', () => {
    expect(findImageSpans('$a ![x](x.png) b$')).toEqual([]);
  });

  it('returns nothing for plain text', () => {
    expect(findImageSpans('no images here')).toEqual([]);
  });
});
