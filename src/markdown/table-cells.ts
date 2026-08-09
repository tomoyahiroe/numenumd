const PIPE = 0x7c; // '|'
const BACKSLASH = 0x5c; // '\'

/**
 * markdown-it の table ルール内部関数 `escapedSplit`
 * (`node_modules/markdown-it/dist/markdown-it.mjs`)と同一挙動の行分割。
 *
 * 「同一挙動」であることが本質なので、意図的に元実装と同じ構造で書いている。
 * 特に次の2点は素朴な `split('|')` との差になるため崩してはいけない:
 *
 * - `\|` は区切りではなくセル本文の `|` になる(バックスラッシュは取り除かれる)。
 * - コードスパン(`` `a|b` ``)の中の `|` は**保護されない**。markdown-it は
 *   ブロック段階でセルを切ってからインライン解析するため、コードスパンの内側でも
 *   容赦なく分割される。ここでも同じく保護しない。
 */
function escapedSplit(str: string): string[] {
  const result: string[] = [];
  const max = str.length;
  let pos = 0;
  let ch = str.charCodeAt(pos);
  let isEscaped = false;
  let lastPos = 0;
  let current = '';

  while (pos < max) {
    if (ch === PIPE) {
      if (!isEscaped) {
        result.push(current + str.substring(lastPos, pos));
        current = '';
        lastPos = pos + 1;
      } else {
        // 直前のバックスラッシュ(pos - 1)を捨て、`|` 自体は本文に残す。
        current += str.substring(lastPos, pos - 1);
        lastPos = pos;
      }
    }
    isEscaped = ch === BACKSLASH;
    pos++;
    ch = str.charCodeAt(pos);
  }

  result.push(current + str.substring(lastPos));
  return result;
}

/**
 * GFM パイプテーブルの1行を、markdown-it が数えるのと**全く同じセル列**に分割する。
 *
 * `parse.ts` はこれを使って「この表は編集可能な table ノードにしても情報が
 * 落ちないか」を判定し、`serialize.ts` は対になる `escapeTableCell` を使って
 * 書き戻す。両者が同じ実装を共有しているのは `math-spans.ts` と同じ理由で、
 * 検出規則が食い違うと往復が壊れるため(パース時には別のセルだと思われたものが
 * シリアライズ時には1セルに潰れる、等)。
 *
 * markdown-it 側の前処理も込みで再現している:
 * - 行全体を `trim()` してから分割する
 * - 先頭・末尾の空セル(= 行を `|` で囲む書き方の産物)を落とす
 * - 各セルの前後の空白を落とす(トークンの `content` に入る形と同じ)
 *
 * 結果として `| a | b |` も `a | b` も等しく `['a', 'b']` になる。
 */
export function splitTableRow(line: string): string[] {
  const cells = escapedSplit(line.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/**
 * セル本文の文字列を、パイプテーブルのセルとして安全に書き出せる形にする
 * (`splitTableRow` の逆方向)。
 *
 * - `|` は `\|` にエスケープする。しないと1セルが2セルに割れて表の形が変わる。
 * - 改行は空白に畳む。GFM のセルは改行を表現できないため、混入すると行が
 *   分断されて表そのものが壊れる。スキーマ側でセルを単一段落に制限し
 *   Shift+Enter も無効化しているので通常は到達しないが、貼り付けなどで
 *   紛れ込んだ場合の最後の砦として畳んでおく。
 *
 * バックスラッシュのエスケープはここでは行わない。セル本文は呼び出し側で
 * すでに `MarkdownSerializerState.esc`(= `serialize.ts` の `safeEsc`)を
 * 通しており、そこで `\` は処理済みだからである。二重にエスケープすると
 * 往復のたびにバックスラッシュが増えていく。
 */
export function escapeTableCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}
