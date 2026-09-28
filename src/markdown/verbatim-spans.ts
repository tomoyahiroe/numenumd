import { matchMathSpanAt } from './math-spans';

const BANG = 0x21; // '!'
const LBRACKET = 0x5b; // '['
const RBRACKET = 0x5d; // ']'
const LPAREN = 0x28; // '('
const RPAREN = 0x29; // ')'
const CARET = 0x5e; // '^'
const BACKSLASH = 0x5c; // '\'
const DOLLAR = 0x24; // '$'
const NEWLINE = 0x0a; // '\n'

function isSpaceOrNewline(code: number | undefined): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === NEWLINE;
}

/**
 * `str[start]` が `open` である前提で、対応する `close` の次の位置を返す
 * (見つからなければ `null`)。同種の括弧のネストを深さで数え、
 * バックスラッシュエスケープ(`\]` など)は区切りとして数えない。
 * 改行はまたがない(インライン記法として扱う範囲を1行に限定する)。
 */
function scanBalanced(
  str: string,
  start: number,
  len: number,
  open: number,
  close: number,
): number | null {
  let depth = 0;
  for (let pos = start; pos < len; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === BACKSLASH) {
      pos++; // 次の1文字は区切りとして数えない
      continue;
    }
    if (ch === NEWLINE) return null;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return pos + 1;
    }
  }
  return null;
}

/**
 * `str[start]` から始まる画像記法 `![…](…)` / `![…][…]` の終端(end-exclusive)を
 * 返す(画像でなければ `null`)。
 *
 * `parse.ts` の `image_verbatim` ルールと `serialize.ts` の `safeEsc` が
 * この関数を共有する。`math-spans` と同じ理由で、パース側とシリアライズ側の
 * 検出規則が食い違うと「パース時には verbatim に保護されたのにシリアライズ時には
 * エスケープされる(またはその逆)」という往復破壊が起きるため、必ず同じ実装を使う。
 *
 * 免除対象を `!` で始まる画像形式に限っているのは意図的で、通常リンク
 * `[t](u)` は serializer が `link` マークから正しく生成するため、地の文に
 * 現れた `[t](u)` 風の文字列は従来どおりエスケープされてよい(そうしないと
 * 再パース時に意図しないリンクへ化けてしまう)。
 *
 * ショートカット参照形式 `![alt]`(定義行だけで括弧が続かない形)は対象外。
 * markdown-it 側で解決されて `![alt](src)` 形に正規化されるため、その結果に
 * 対してこの関数が改めてマッチする。
 */
export function matchImageSpanAt(
  str: string,
  start: number,
  len: number = str.length,
): number | null {
  if (str.charCodeAt(start) !== BANG) return null;
  if (start + 1 >= len || str.charCodeAt(start + 1) !== LBRACKET) return null;

  const afterLabel = scanBalanced(str, start + 1, len, LBRACKET, RBRACKET);
  if (afterLabel === null || afterLabel >= len) return null;

  const next = str.charCodeAt(afterLabel);
  // インライン形式 `![alt](src "title")`
  if (next === LPAREN)
    return scanBalanced(str, afterLabel, len, LPAREN, RPAREN);
  // 参照形式 `![alt][ref]` / 折りたたみ参照形式 `![alt][]`
  if (next === LBRACKET)
    return scanBalanced(str, afterLabel, len, LBRACKET, RBRACKET);
  return null;
}

/**
 * `str[start]` から始まる GFM 脚注マーカー `[^label]` の終端(end-exclusive)を
 * 返す(脚注マーカーでなければ `null`)。
 *
 * GFM のラベルは空白を含まないため、空白・改行・入れ子の `[` が現れた時点で
 * 不成立とする。空ラベル `[^]` も対象外。
 *
 * 保護しないと二重に壊れる:
 * - 定義行 `[^1]: note` があると markdown-it の `reference` ルールがこれを
 *   参照定義として登録してしまい、インライン `[^1]` が参照リンクとして解決されて
 *   `text[^1](note)` に化ける。
 * - 定義行が無い場合も `safeEsc` の `[`/`]` 常時エスケープで `a\[^note\] b` になる。
 */
export function matchFootnoteMarkerAt(
  str: string,
  start: number,
  len: number = str.length,
): number | null {
  if (str.charCodeAt(start) !== LBRACKET) return null;
  if (start + 1 >= len || str.charCodeAt(start + 1) !== CARET) return null;

  for (let pos = start + 2; pos < len; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === RBRACKET) {
      // 空ラベル `[^]` は脚注扱いしない
      return pos === start + 2 ? null : pos + 1;
    }
    if (ch === LBRACKET || isSpaceOrNewline(ch)) return null;
  }
  return null;
}

/**
 * `str` 全体から「エスケープしてはいけない範囲」(`[start, end)`)を全て検出する。
 *
 * 対象は3種類:
 * - インライン数式 `$…$`(`./math-spans`)
 * - 画像 `![…](…)` / `![…][…]`
 * - GFM 脚注マーカー `[^…]`
 *
 * いずれも numenumd では専用ノード/マークを持たずプレーンテキストとして保持する
 * 記法であり、`MarkdownSerializerState.esc()` の既定実装がこれらの構文文字
 * (`[` `]` `*` `_` `\` など)を無条件にエスケープすると、ユーザーの Markdown が
 * 無警告で壊れる(= プロジェクト原則「ユーザーの Markdown を絶対に失わない」違反)。
 *
 * ネスト・オーバーラップは考慮しない(見つかった範囲の直後から走査を再開する)。
 */
export function findVerbatimSpans(str: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const len = str.length;
  let i = 0;
  while (i < len) {
    const ch = str.charCodeAt(i);
    let end: number | null = null;
    if (ch === DOLLAR) {
      const close = matchMathSpanAt(str, i, len);
      end = close === null ? null : close + 1;
    } else if (ch === BANG) {
      end = matchImageSpanAt(str, i, len);
    } else if (ch === LBRACKET) {
      end = matchFootnoteMarkerAt(str, i, len);
    }
    if (end !== null && end > i) {
      spans.push([i, end]);
      i = end;
    } else {
      i++;
    }
  }
  return spans;
}

/**
 * Image spans only (`![…](…)` / `![…][…]`), found with the same scan as
 * `findVerbatimSpans`, so exactly the spans the parser keeps verbatim are
 * reported and image-like text inside `$…$` math is skipped. Used by the
 * editor's image preview.
 */
export function findImageSpans(str: string): Array<[number, number]> {
  return findVerbatimSpans(str).filter(
    ([start]) => str.charCodeAt(start) === BANG,
  );
}
