import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { escapeTableCell, splitTableRow } from './table-cells';

/**
 * `row` をヘッダ行とする最小の表を markdown-it に食わせ、生成された `th` の
 * 本文を取り出す。`splitTableRow` が数えたセル数でデリミタ行を作るので、
 * セル数の見立てが markdown-it とズレていると `columnCount !== aligns.length`
 * で table ルール自体が不成立になり、`null` が返る。
 * つまりこの関数は本文の一致だけでなく**セル数の一致**も同時に検証している。
 */
function headerCellsViaMarkdownIt(row: string): string[] | null {
  const width = splitTableRow(row).length;
  const src = `${row}\n${'|---'.repeat(width)}|\n`;
  const tokens = new MarkdownIt().parse(src, {});
  if (!tokens.some((t) => t.type === 'table_open')) return null;

  const cells: string[] = [];
  let inHeaderCell = false;
  for (const token of tokens) {
    if (token.type === 'th_open') inHeaderCell = true;
    else if (token.type === 'th_close') inHeaderCell = false;
    else if (inHeaderCell && token.type === 'inline') cells.push(token.content);
  }
  return cells;
}

describe('splitTableRow', () => {
  it('splits a fully piped row', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
  });

  it('splits a row without leading/trailing pipes', () => {
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
  });

  it('keeps an escaped pipe inside a cell and drops the backslash', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });

  it('does not protect pipes inside code spans (same as markdown-it)', () => {
    expect(splitTableRow('| `a|b` | c |')).toEqual(['`a', 'b`', 'c']);
  });

  it('keeps interior empty cells but drops the pipe-wrapping ones', () => {
    expect(splitTableRow('|  | b |  |')).toEqual(['', 'b', '']);
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c']);
  });

  it('keeps a literal backslash that precedes an escaped pipe', () => {
    // `a\\|b` は「バックスラッシュそのもの + 区切りではない `|`」を意味する。
    expect(splitTableRow('| a\\\\|b |')).toEqual(['a\\|b']);
  });
});

// 判定規則が markdown-it とズレると「パース時には2セルだと思ったのに
// markdown-it は3セルに切っていた」という形で往復が壊れる。実装のコピーでは
// なく、markdown-it の実際の出力との同値をテストで固定する。
describe('splitTableRow (markdown-it との同値)', () => {
  const rows = [
    '| a | b |',
    'a | b',
    '| a \\| b | c |',
    '| `a|b` | c |',
    '|  | b |  |',
    '| a |  | c |',
    '| a\\\\|b |',
    '|   spaced   | x |',
    '| $x_{i}$ | **bold** |',
    '| 日本語 | テスト |',
  ];

  for (const row of rows) {
    it(`matches markdown-it for ${JSON.stringify(row)}`, () => {
      expect(headerCellsViaMarkdownIt(row)).toEqual(splitTableRow(row));
    });
  }
});

describe('escapeTableCell', () => {
  it('escapes pipes so a cell cannot split into two', () => {
    expect(escapeTableCell('a|b')).toBe('a\\|b');
    expect(splitTableRow(`| ${escapeTableCell('a|b')} |`)).toEqual(['a|b']);
  });

  it('folds newlines into spaces (GFM cells cannot contain line breaks)', () => {
    expect(escapeTableCell('a\nb')).toBe('a b');
    expect(escapeTableCell('a\r\nb')).toBe('a b');
  });

  it('leaves backslashes alone (esc() has already handled them)', () => {
    expect(escapeTableCell('\\alpha')).toBe('\\alpha');
  });

  it('round-trips a cell containing pipes through markdown-it', () => {
    const original = 'a|b|c';
    const row = `| ${escapeTableCell(original)} | x |`;
    expect(headerCellsViaMarkdownIt(row)).toEqual([original, 'x']);
  });
});
