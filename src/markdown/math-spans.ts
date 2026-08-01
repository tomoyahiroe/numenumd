const DOLLAR = 0x24; // '$'
const NEWLINE = 0x0a; // '\n'

function isAsciiSpace(code: number | undefined): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d;
}

/**
 * `str[start]` が `$` である前提で、そこから始まる妥当なインライン数式
 * `$...$` の閉じ `$` の位置(index)を返す(見つからなければ `null`)。
 *
 * `parse.ts` の `math_inline` ルールと `serialize.ts` の `safeEsc` の
 * 両方がこの関数を共有する。検出規則が食い違うと、パース時には数式として
 * 保護されたのにシリアライズ時にはエスケープされる(またはその逆)といった
 * 往復破壊が起きるため、必ず同じロジックを使う。
 *
 * 判定基準は Pandoc のインライン数式区切りヒューリスティックに準拠する:
 * - 開き `$` の直後は非空白であること
 * - 閉じ `$` の直前は非空白であること、かつ閉じ `$` の直後が数字でないこと
 * - 改行をまたがない
 * - `$$`(ブロック数式のフェンスと紛らわしい)に隣接しない
 *
 * これにより `The price is $5 and *sale* items are $10 today.` のような
 * 地の文中の(対になっていない)金額表記の `$` を数式と誤認しなくなる一方、
 * `$x_{i}$` のような正当な数式は引き続き検出できる。
 *
 * @param str 走査対象の文字列全体
 * @param start `$` の開始位置(この位置の文字は `$` でなければならない)
 * @param len 走査を打ち切る境界(省略時は `str.length`)。markdown-it の
 *   インライン parsing 中は `state.posMax` を渡すことで、現在のインライン
 *   コンテキストの外まで走査しないようにする。
 */
export function matchMathSpanAt(
  str: string,
  start: number,
  len: number = str.length,
): number | null {
  if (str.charCodeAt(start) !== DOLLAR) return null;
  // `$$` に隣接する場合は対象外(ブロック数式のフェンスと紛らわしいため)。
  if (start + 1 < len && str.charCodeAt(start + 1) === DOLLAR) return null;
  if (start > 0 && str.charCodeAt(start - 1) === DOLLAR) return null;
  // 開き `$` の直後が無い、または空白の場合は数式として扱わない。
  if (start + 1 >= len || isAsciiSpace(str.charCodeAt(start + 1))) return null;

  for (let pos = start + 1; pos < len; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === NEWLINE) return null; // 改行をまたぐ場合は数式扱いしない
    if (ch !== DOLLAR) continue;
    const prev = str.charCodeAt(pos - 1);
    const next = pos + 1 < len ? str.charCodeAt(pos + 1) : undefined;
    const prevIsSpace = isAsciiSpace(prev);
    const nextIsDigit = next !== undefined && next >= 0x30 && next <= 0x39;
    if (!prevIsSpace && !nextIsDigit) return pos;
    // この `$` は閉じ候補として不適格(前が空白、または直後が数字)。
    // 地の文の一部とみなし、より後ろにある `$` を探し続ける。
  }
  return null;
}

/**
 * `str` 全体から `$...$` の範囲(`[start, end)`、`end` は閉じ `$` の次の
 * 位置)を全て検出する。ネスト・オーバーラップは考慮しない(見つかった
 * 範囲の直後から次の走査を再開する)。
 */
export function findMathSpans(str: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const len = str.length;
  let i = 0;
  while (i < len) {
    if (str.charCodeAt(i) !== DOLLAR) {
      i++;
      continue;
    }
    const close = matchMathSpanAt(str, i, len);
    if (close !== null) {
      spans.push([i, close + 1]);
      i = close + 1;
    } else {
      i++;
    }
  }
  return spans;
}
