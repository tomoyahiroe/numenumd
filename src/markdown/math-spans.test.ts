import { describe, it, expect } from 'vitest';
import { createMathSpanRegex, findMathSpans } from './math-spans';
import { buildExtensions } from '../editor/extensions';

function spansViaRegex(str: string): Array<[number, number]> {
  const re = createMathSpanRegex();
  const spans: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

// 表示系(@tiptap/extension-mathematics の KaTeX デコレーション)と
// 保存系(parse.ts の math_inline / serialize.ts の safeEsc)で
// インライン数式の検出規則が乖離していた問題(レビュー Important 4件目)。
//
// 表示系の拡張は「マッチ判定を差し替える手段」として `regex` オプション
// (RegExp のみ)しか提供していないため、`math-spans` が Pandoc 流の判定を
// 正規表現としても提供し(`createMathSpanRegex`)、両者を単一ソースにした。
//
// jsdom 上で ProseMirror の decoration そのものを検証するのは現実的でないため、
// (1) 共有 regex の判定、(2) regex と `findMathSpans` の突き合わせ、
// (3) 拡張に実際にその regex が渡っていること、の3点で担保する。
describe('createMathSpanRegex (display/save detection parity)', () => {
  it('does not treat prose dollar amounts as math', () => {
    expect(spansViaRegex('The price is $5 and $10 today.')).toEqual([]);
    expect(spansViaRegex('$5 and $10')).toEqual([]);
  });

  it('detects genuine inline math', () => {
    expect(spansViaRegex('$x_{i}$')).toEqual([[0, 7]]);
    expect(spansViaRegex('see $a^{*}$ here')).toEqual([[4, 11]]);
    expect(spansViaRegex('$50\\%$')).toEqual([[0, 6]]);
  });

  it('exposes the latex body as capture group 1 (used by the extension)', () => {
    // MathematicsPlugin は `match.slice(1).find(Boolean)` を KaTeX へ渡す。
    const m = createMathSpanRegex().exec('a $x_{i}$ b');
    expect(m?.slice(1).find(Boolean)).toBe('x_{i}');
  });

  it('returns a fresh RegExp each call (g フラグの lastIndex 共有を避ける)', () => {
    const a = createMathSpanRegex();
    const b = createMathSpanRegex();
    expect(a).not.toBe(b);
    expect(a.global).toBe(true);
  });

  it('agrees with findMathSpans across a corpus', () => {
    const corpus = [
      '$x_{i}$',
      'The price is $5 and *sale* items are $10 today.',
      'Costs $5 and `code` here $10 today.',
      'a $b$ c',
      '$$x$$',
      'cost $5',
      '$ x $',
      'x$y$z',
      '$50\\%$',
      '$a^{*}$',
      '$\\{a\\}$',
      'no dollars at all',
      '$1,000 and $2,000',
      'mix $\\alpha$ and $5 dollars',
      'end $z$',
      'multi $a\nb$ line',
      'trailing $',
      '$',
      '',
    ];
    for (const s of corpus) {
      expect(spansViaRegex(s), `corpus: ${JSON.stringify(s)}`).toEqual(
        findMathSpans(s),
      );
    }
  });

  it('is wired into the Mathematics extension instead of its default regex', () => {
    const mathematics = buildExtensions().find(
      (e) => e.name === 'Mathematics',
    ) as { options: { regex: RegExp } } | undefined;
    expect(mathematics).toBeDefined();
    expect(mathematics!.options.regex.source).toBe(
      createMathSpanRegex().source,
    );
    // 既定の素朴な regex(`$` に挟まれていれば何でも数式)ではないこと。
    expect(mathematics!.options.regex.test('$5 and $10')).toBe(false);
  });
});
