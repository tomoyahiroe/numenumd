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
 * `matchMathSpanAt` と同じ Pandoc 流ヒューリスティックを単一の正規表現として
 * 表現したもの(毎回新しい `RegExp` を返す — `g` フラグ付き正規表現は
 * `lastIndex` を持つ可変オブジェクトなので、共有インスタンスを配ると
 * 呼び出し側同士が干渉する)。
 *
 * 表示系の `@tiptap/extension-mathematics` は「マッチ判定を差し替える手段」として
 * `regex` オプション(`RegExp`、`g` フラグ必須・キャプチャグループ1が数式本文)
 * しか提供していない。既定値は `/\$([^$]*)\$/gi` で「`$` に挟まれていれば
 * 何でも数式」という素朴な規則のため、`The price is $5 and $10 today.` の
 * ような地の文の金額表記を KaTeX で誤レンダリングしてしまう一方、保存系
 * (`parse.ts` の `math_inline` / `serialize.ts` の `safeEsc`)は
 * `matchMathSpanAt` を使っており、表示と保存で検出規則が乖離していた。
 * そこで検出規則の定義をこのモジュールに一本化し、表示系にはこの正規表現を
 * 渡す(`editor/extensions.ts` を参照)。
 *
 * 各部の対応:
 * - `(?<!\$)\$(?=[^ \t\r\n$])` … 開き `$`。直前・直後が `$` でなく
 *   (`$$` ブロック数式との混同を避ける)、直後が空白/改行でないこと。
 * - 本文 … 改行を含まない。途中の `$` は「閉じ候補として不適格」な場合
 *   (直前が空白 / 直後が数字)に限り本文の一部として認める。
 * - `(?<=[^ \t\r])\$(?!\d)` … 閉じ `$`。直前が空白でなく、直後が数字でないこと。
 *
 * 遅延量指定子(`*?`)により、`matchMathSpanAt` の「最初に見つかった妥当な
 * 閉じ `$` を採用する」挙動と一致する。両者が同じ判定を返すことは
 * `math-spans.test.ts` の突き合わせテストで担保している。
 */
export function createMathSpanRegex(): RegExp {
  return /(?<!\$)\$(?=[^ \t\r\n$])((?:[^\n$]|\$(?=\d)|(?<=[ \t\r])\$)*?)(?<=[^ \t\r])\$(?!\d)/g;
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
