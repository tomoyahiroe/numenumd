import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { mdToMd } from './format';
import { splitFrontmatter } from './frontmatter';

const dir = join(__dirname, '../../tests/fixtures');

describe('serialize', () => {
  it('serializes basic blocks back to markdown', () => {
    const md = '# h1\n\n- a\n- b\n\n> quote\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes taskList back as - [x] / - [ ]', () => {
    const md = '- [x] done\n- [ ] todo\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes mathBlock back as $$ fenced block', () => {
    const md = '$$\nE = mc^2\n$$\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes rawBlock content verbatim', () => {
    const md = '<div class="note">\nhi\n</div>\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('restores frontmatter at head', () => {
    const md = '---\ntitle: t\n---\n\n# h\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

describe('mdToMd (golden + idempotency)', () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    it(`round-trips ${f} losslessly after one format`, async () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const once = await mdToMd(src);
      const twice = await mdToMd(once);
      expect(twice).toBe(once); // 冪等: 2回保存しても差分ゼロ
    });
  }

  it('normalizes bullets to - and headings to ATX', async () => {
    expect(await mdToMd('* item\n')).toBe('- item\n');
  });
});

// レビュー Finding 1: インライン数式($…$)の中身が esc() によって壊れる
// (`_`/`*` の常時エスケープ、`\{`/`\%` の CommonMark エスケープ解決)問題の
// 回帰テスト。parse.ts の math_inline ルールと serialize.ts の safeEsc の
// $…$ 範囲保護の両方が効いて初めて全て通る。
describe('inline math survives escaping (review finding 1)', () => {
  const cases = ['$x_{i}$\n', '$\\{a\\}$\n', '$a^{*}$\n', '$50\\%$\n'];

  for (const md of cases) {
    it(`serializes ${JSON.stringify(md)} unchanged`, () => {
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });

    it(`keeps ${JSON.stringify(md)} idempotent through mdToMd`, async () => {
      const once = await mdToMd(md);
      const twice = await mdToMd(once);
      expect(twice).toBe(once);
    });
  }
});

// レビュー ラウンド2 Finding(ラウンド1の math_inline 修正が持ち込んだ回帰):
// 素朴な $…$ ペア検出が、地の文中の対になっていない $(金額表記など)を
// 数式と誤認し、その間に挟まれた強調/コードスパン等のインライン記法を
// 丸ごと verbatim テキストへ壊してしまっていた問題。
// Pandoc 流ヒューリスティック(開き $ の直後は非空白、閉じ $ の直前は
// 非空白かつ直後が数字でない)を parse.ts の math_inline と serialize.ts の
// safeEsc の双方が共有する `./math-spans` に実装して解消した。
describe('unpaired prose $ does not swallow other inline markup (review round 2)', () => {
  it('keeps italic emphasis intact around unpaired dollar amounts', () => {
    const md = 'The price is $5 and *sale* items are $10 today.\n';
    const doc = parseMarkdown(md);
    const marks =
      doc.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks.some((m) => m.type === 'italic')).toBe(true);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('keeps inline code intact around unpaired dollar amounts', () => {
    const md = 'Costs $5 and `code` here $10 today.\n';
    const doc = parseMarkdown(md);
    const marks =
      doc.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks.some((m) => m.type === 'code')).toBe(true);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('still detects genuine inline math among the same 4 cases as round 1', () => {
    for (const md of ['$x_{i}$\n', '$\\{a\\}$\n', '$a^{*}$\n', '$50\\%$\n']) {
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    }
  });

  it('is idempotent through mdToMd for the prose-with-unpaired-$ cases', async () => {
    for (const md of [
      'The price is $5 and *sale* items are $10 today.\n',
      'Costs $5 and `code` here $10 today.\n',
    ]) {
      const once = await mdToMd(md);
      const twice = await mdToMd(once);
      expect(twice).toBe(once);
    }
  });
});

// 最終レビュー Important: リンクの title(`[t](href "Title")` の第2引数)が
// スキーマに属性を持たず、保存で無音消失していた問題の回帰テスト。
// extensions.ts の LinkWithTitle(`title` 属性)+ parse.ts の
// link getAttrs + prosemirror-markdown 既定の link マークが揃って初めて通る。
describe('link title survives the round trip (final review)', () => {
  it('keeps the title in the parsed mark attrs', () => {
    const doc = parseMarkdown('[t](https://x.jp "Title")\n');
    const marks = doc.content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks[0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://x.jp', title: 'Title' },
    });
  });

  it('serializes the title back byte-for-byte', () => {
    const md = '[t](https://x.jp "Title")\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('keeps a titled link idempotent through mdToMd', async () => {
    const md = '[t](https://x.jp "Title")\n';
    const once = await mdToMd(md);
    const twice = await mdToMd(once);
    expect(once).toContain('Title');
    expect(twice).toBe(once);
  });

  it('still serializes a link without a title as before', () => {
    const md = '[t](https://x.jp)\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

// 最終レビュー Important: タスク項目と通常項目が混在したリストは
// (taskListRule が「全項目タスク」のときだけ taskList 化する設計のため)
// bulletList のまま保持されるが、safeEsc が `[` / `]` を常時エスケープして
// `- \[x\] done` に化け、GitHub 上でチェックボックスとして描画されなくなる
// 問題の回帰テスト。serialize.ts の listItem レンダラ側で先頭マーカーだけ
// エスケープを免除する方式を採った。
describe('mixed task/plain list keeps its checkbox syntax (final review)', () => {
  const mixed = '- [x] done\n- plain\n';

  it('round-trips a mixed list byte-for-byte', () => {
    expect(serializeMarkdown(parseMarkdown(mixed))).toBe(mixed);
  });

  it('round-trips a mixed list that starts with a plain item', () => {
    const md = '- plain\n- [ ] todo\n- [X] done\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('is idempotent through mdToMd', async () => {
    const once = await mdToMd(mixed);
    const twice = await mdToMd(once);
    expect(once).toBe(mixed);
    expect(twice).toBe(once);
  });

  it('stays a bulletList (not a taskList) on re-parse, so the output is stable', () => {
    const doc = parseMarkdown(serializeMarkdown(parseMarkdown(mixed)));
    expect(doc.content?.[0]?.type).toBe('bulletList');
  });

  it('still escapes brackets that are not a leading task marker', () => {
    const md = '- a \\[x\\] b\n- plain\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('leaves an all-task list on the taskList path unchanged', () => {
    const md = '- [x] done\n- [ ] todo\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    expect(parseMarkdown(md).content?.[0]?.type).toBe('taskList');
  });
});

// マージゲート Blocking: 画像記法が保存で必ず壊れる問題の回帰テスト。
// `safeEsc` が `[` / `]` を無条件エスケープしていたため `![alt](a.png)` が
// `!\[alt\](a.png)` に化け、どのレンダラでも画像が表示されなくなっていた
// (無警告・復旧不能)。parse.ts の image_verbatim ルール(記法を verbatim
// テキストとして切り出す)と serialize.ts の safeEsc のスキップレンジ
// (`verbatim-spans` 経由)の両方が効いて初めて全て通る。
describe('image syntax survives the round trip (merge gate blocker)', () => {
  const cases: Array<[string, string]> = [
    ['inline', 'See ![alt](img/a.png) inline.\n'],
    ['standalone line', '![alt](img/a.png)\n'],
    ['inside a heading', '# Head ![alt](img/a.png)\n'],
    ['reference form', '![alt][ref]\n\n[ref]: img/a.png\n'],
  ];

  for (const [name, md] of cases) {
    it(`serializes the ${name} form byte-for-byte`, () => {
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });

    it(`keeps the ${name} form byte-identical through mdToMd`, async () => {
      const once = await mdToMd(md);
      expect(once).toBe(md);
      expect(await mdToMd(once)).toBe(once);
    });
  }

  it('keeps a titled image and preserves the title text', () => {
    const md = "![alt](img/a.png 'Caption')\n";
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('keeps an image nested inside a bold span', () => {
    const md = '**![alt](img/a.png)**\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('never emits an escaped bang-bracket for any image form', () => {
    for (const [, md] of cases) {
      expect(serializeMarkdown(parseMarkdown(md))).not.toContain('!\\[');
    }
  });

  it('still escapes a plain (non-image) bracket run in prose', () => {
    // 免除は `!` で始まる画像形式と `[^` 脚注のみ。地の文の `[t](u)` 風文字列は
    // 従来どおりエスケープされてよい(通常リンクは link マークから生成される)。
    const doc = parseMarkdown('a \\[t\\](u) b\n');
    expect(serializeMarkdown(doc)).toBe('a \\[t\\](u) b\n');
  });

  it('leaves a real link mark untouched', () => {
    const md = 'see [t](https://x.jp) here\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

// マージゲート 同根 Finding: GFM 脚注風記法の破壊。
// (a) `text[^1]` + 定義行 `[^1]: note` → markdown-it が定義行を参照定義として
//     解決し、インライン `[^1]` がリンク化されて `text[^1](note)` になっていた。
// (b) 定義の無い `a[^note] b` → safeEsc により `a\[^note\] b` になっていた。
describe('GFM footnote syntax survives the round trip (merge gate blocker)', () => {
  it('does not turn an inline marker into a link when a definition exists', () => {
    const doc = parseMarkdown('text[^1]\n\n[^1]: note\n');
    const marks =
      doc.content?.[0]?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks.some((m) => m.type === 'link')).toBe(false);
  });

  it('keeps the definition line verbatim as a rawBlock', () => {
    const doc = parseMarkdown('text[^1]\n\n[^1]: note\n');
    expect(doc.content?.[1]).toMatchObject({
      type: 'rawBlock',
      attrs: { content: '[^1]: note' },
    });
  });

  it('serializes marker + definition byte-for-byte', () => {
    const md = 'text[^1]\n\n[^1]: note\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('keeps marker + definition byte-identical through mdToMd', async () => {
    const md = 'text[^1]\n\n[^1]: note\n';
    const once = await mdToMd(md);
    expect(once).toBe(md);
    expect(await mdToMd(once)).toBe(once);
  });

  it('does not escape a marker that has no definition', () => {
    const md = 'a[^note] b\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

// レビュー Finding 2: mdToMd が frontmatter ごと Prettier に通してしまい、
// verbatim 書き戻しの原則(numenumd プロジェクトルール)に違反する問題の回帰テスト。
describe('frontmatter stays verbatim through mdToMd (review finding 2)', () => {
  it('does not let Prettier reformat a messy frontmatter block', async () => {
    const md = '---\ntitle:    Messy   \n  nested:    1\n---\n\nbody\n';
    const { frontmatter: expected } = splitFrontmatter(md);

    const once = await mdToMd(md);
    const { frontmatter: actual } = splitFrontmatter(once);

    expect(actual).toBe(expected);
  });
});

// レビュー Finding 3: 空ドキュメントで mdToMd が例外を出さないことの回帰テスト
// (serializeMarkdown の空 doc 分岐、および Prettier への空文字列入力の両方を通す)。
describe('empty document handling (review finding 3)', () => {
  it('mdToMd on an empty string resolves without throwing', async () => {
    const result = await mdToMd('');
    expect(typeof result).toBe('string');
  });
});

// 表(GFM パイプテーブル)の往復。spec「テーブル(GFM パイプテーブル)」節の
// 決定を、実際の入出力として固定する。
describe('tables round-trip through table nodes', () => {
  const serialized = (md: string) => serializeMarkdown(parseMarkdown(md));

  it('writes a plain table back unchanged', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    expect(serialized(md)).toBe(md);
  });

  it('normalizes a tightly written table into the canonical form', () => {
    expect(serialized('|a|b|\n|-|-|\n|1|2|\n')).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    );
  });

  it('keeps column alignment', () => {
    expect(
      serialized('| l | c | r |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n'),
    ).toBe('| l | c | r |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n');
  });

  it('re-escapes a pipe inside a cell so the column count is preserved', () => {
    const md = '| a | b |\n| --- | --- |\n| x \\| y | z |\n';
    expect(serialized(md)).toBe(md);
    // 二度目も同じ = バックスラッシュが増殖しない。
    expect(serialized(serialized(md))).toBe(md);
  });

  it('pads a short row with an empty cell', () => {
    expect(serialized('| a | b |\n| --- | --- |\n| 1 |\n')).toBe(
      '| a | b |\n| --- | --- |\n| 1 |  |\n',
    );
  });

  it('does not escape leading block markers inside a cell', () => {
    // セルの中では `- ` は箇条書きを始めないので、`\- ` にする必要はない。
    const md = '| a |\n| --- |\n| - x |\n';
    expect(serialized(md)).toBe(md);
  });

  it('keeps inline math and images intact inside cells', () => {
    const md = '| a | b |\n| --- | --- |\n| $x_{i}$ | ![i](p.png) |\n';
    expect(serialized(md)).toBe(md);
  });

  it('keeps a table inside a blockquote prefixed with >', () => {
    const md = '> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n';
    expect(serialized(md)).toBe(md);
  });

  it('keeps a table inside a list item indented', () => {
    const md = '- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n';
    expect(serialized(md)).toBe(md);
  });

  // ハイブリッドの肝。ヘッダ列数を超えるセルは GFM が捨てるので、そういう表は
  // table ノードに変換せず rawBlock のまま1バイトも変えずに書き戻す。
  it('writes a table with excess cells back byte-for-byte', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n';
    expect(serialized(md)).toBe(md);
    expect(parseMarkdown(md).content?.[0]?.type).toBe('rawBlock');
  });

  it('keeps every table shape idempotent through mdToMd', async () => {
    const cases = [
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '|a|b|\n|-|-|\n|1|2|\n',
      '| l | c | r |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n',
      '| a | b |\n| --- | --- |\n| x \\| y | z |\n',
      '| a | b |\n| --- | --- |\n| 1 |\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n',
      '> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n',
    ];
    for (const md of cases) {
      const once = await mdToMd(md);
      expect(await mdToMd(once), md).toBe(once);
    }
  });
});
