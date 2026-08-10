# Markdown 表(GFM パイプテーブル)対応 Implementation Plan

**Goal:** GFM パイプテーブルを WYSIWYG で編集できるようにする。ただし往復で情報が
落ちる表(ヘッダ列数を超えるセルを持つ行がある表)は従来どおり `rawBlock` で
verbatim 保全し、「ユーザーの Markdown を絶対に失わない」原則を崩さない。

**Spec:** `docs/superpowers/specs/2026-08-01-numenumd-design.md`(「テーブル(GFM パイプテーブル)」節)
**MTG 議事録:** `docs/mtg/2026-08-09-markdown-table.md`
**Branch:** `feat/table`(`main` から。ストア公開 PR #7 とは独立)
**Version:** 0.3.0

## 背景と現状

`src/markdown/parse.ts:332` の `wrapAsRawBlock('table')` が markdown-it の table
ルールを横取りし、すべての表を1個の `rawBlock` に潰している。これは MVP の
意図的な仕様(spec 旧 L100「テーブルは MVP では編集対象外」)であって、バグでは
ない。本計画はこれを条件付きに緩める。

## なぜハイブリッドが必要か(調査済みの事実)

markdown-it の table ルール(`node_modules/markdown-it/dist/markdown-it.mjs:1528`)
の本文行ループは `for (let i = 0; i < columnCount; i++)` で、`columnCount` は
**ヘッダ行のセル数**。つまり本文行がヘッダより多いセルを持つと、超過分の
トークンは生成されず**黙って消える**。実測:

```
| a | b |
|---|:-:|
| 1 | 2 | 3 |   → `3` が消える(GFM 仕様どおり)
| 4 |           → 空セルが補完される(情報は落ちない)
```

セル分割は `escapedSplit`(同 L1504)が担当し、**バックスラッシュエスケープのみ**
考慮する(コードスパン内の `|` も分割される)。先頭/末尾の空セルは shift/pop で
落とされる。この分割規則をパース側の判定とシリアライズ側のエスケープで共有しないと
往復が壊れるため、単一ソース化する。

## Global Constraints

- 既存の全テスト・lint・typecheck・build をグリーンに保つ。
- 表以外の記法の往復挙動を変えない(特に blockquote / リスト内の表、HTML テーブル、
  参照リンク定義の rawBlock 保全)。
- コミットは Conventional Commits。
- マージゲート: CI グリーン + このセッションの文脈を共有しない独立 subagent の承認。

---

### Task 1: セル分割ロジックの単一ソース化

**Files:**

- Create: `src/markdown/table-cells.ts`, `src/markdown/table-cells.test.ts`

**Step 1 — 実装**

`escapedSplit` と同一挙動の `splitTableRow(line: string): string[]` を書く。
markdown-it 側の前処理(`trim()` → split → 先頭/末尾の空セルを shift/pop)まで
含めて 1 関数にまとめ、markdown-it が数えるのと**同じセル数**を返すこと。

併せて逆方向の `escapeTableCell(text: string): string` を置く(`|` → `\|`、
改行を空白へ畳む)。パースとシリアライズが同じファイルを見る形にする。

**Step 2 — テスト**

- `| a | b |` → `['a', 'b']`
- `a | b`(先頭末尾パイプなし)→ `['a', 'b']`
- `| a \| b | c |` → `['a | b', 'c']`(エスケープされたパイプは分割しない)
- ``| `a|b` | c |`` → 3セル(コードスパンは保護されない = markdown-it と同じ)
- `escapeTableCell('a|b')` → `'a\\|b'`、往復して `splitTableRow` で1セルに戻る

**検証:** markdown-it に同じ行を食わせて生成された `td` の数と `splitTableRow` の
長さが一致することを、上記ケース全部で突き合わせるテストを1本入れる(実装の
コピーではなく**挙動の同値**を固定する)。

---

### Task 2: table 拡張をスキーマに入れる

**Files:**

- Modify: `package.json`, `src/editor/extensions.ts`
- Create: `src/editor/nodes/table.ts`

**Step 1 — 依存追加**

```
npm i @tiptap/extension-table@^2.27.2 @tiptap/extension-table-row@^2.27.2 \
      @tiptap/extension-table-cell@^2.27.2 @tiptap/extension-table-header@^2.27.2
```

(本プロジェクトは tiptap v2 系。`latest` は v3 なのでバージョン固定を忘れない。)

**Step 2 — ノード定義(`src/editor/nodes/table.ts`)**

- `TableCell` / `TableHeader` を `.extend({ content: 'paragraph' })` で単一段落に制限。
- 両者に `alignment: { default: null }` 属性を追加(`'left' | 'center' | 'right' | null`)。
  `renderHTML` では `style="text-align:…"`、`parseHTML` では style から復元する。
- 列幅リサイズは無効のまま(列幅は GFM に書けないので保持できない)。
  `resizable` は `@tiptap/extension-table` の既定値がすでに `false` なので
  `configure` は不要。`mergeCells` は UI に出さない。
- セル内 Shift+Enter 無効化: `addKeyboardShortcuts` で表内にカーソルがあるとき
  `Shift-Enter` を握り潰す(`true` を返す)。

**Step 3 — `buildExtensions()` に追加**

`extensions.ts` に上記を足す。この時点でスキーマに table ノードが入るので、
`parse.ts` / `serialize.ts` が `getSchema(buildExtensions())` 経由で認識する。

**検証:** `src/editor/extensions.test.ts` にスキーマ検査を足す。
`tableCell` の content が `paragraph`(`block+` ではない)であること、
`alignment` 属性が存在することを直接アサートする。

---

### Task 3: parse.ts をハイブリッド判定にする

**Files:**

- Modify: `src/markdown/parse.ts`, `src/markdown/parse.test.ts`

**Step 1 — `wrapAsRawBlock('table')` を条件付きに置き換える**

`raw_table` ルールを、元の table ルールを呼んだあとに**判定してから分岐**する形に
変える:

1. 元ルールを実行(トークンが積まれる)。
2. 行範囲 `[startLine, state.line)` の本文行(= `startLine + 2` 以降)を
   `splitTableRow` で数え、ヘッダのセル数を超える行が1つでもあるか調べる。
3. 超過あり → 積まれたトークンを捨てて `raw_block` 1個に差し替える(現行の挙動)。
   超過なし → 何もしない(table トークンをそのまま通す)。

コンテナ(blockquote / リスト)内でもマーカーが混入しないよう、行の取得は
現行と同じく `state.getLines(n, n + 1, state.blkIndent, false)` を使う。

**Step 2 — セルの inline を paragraph でラップする core rule**

`tableCell` の content は `paragraph` なので、markdown-it の `th_open, inline,
th_close` をそのまま流すと `createAndFill` が失敗してセルが**黙って消える**。
`th_open` / `td_open` の直後と `*_close` の直前へ `paragraph_open` /
`paragraph_close` トークンを挿す core rule を足す。挿すのはブロックトークン
だけなので、`inline` ルールの前でも後でも結果は変わらない(実装では
`md.core.ruler.push` で最後に登録している)。

**Step 3 — トークンマップ**

```ts
table: { block: 'table' },
thead: { ignore: true },
tbody: { ignore: true },
tr:    { block: 'tableRow' },
th:    { block: 'tableHeader', getAttrs: (tok) => ({ alignment: alignOf(tok) }) },
td:    { block: 'tableCell',   getAttrs: (tok) => ({ alignment: alignOf(tok) }) },
```

`alignOf` は `tok.attrGet('style')` の `text-align:…` を読む。

**検証(`parse.test.ts`):**

- 安全な表 → `table > tableRow > tableHeader/tableCell > paragraph` の構造になる。
- 超過セルを持つ表 → `rawBlock` で原文そのまま(既存テストの意図を移植)。
- 揃え記法 → 各セルの `alignment` が `left/center/right/null` で入る。
- blockquote 内の安全な表 → `blockquote > table`(マーカー混入なし)。
- blockquote 内の超過セル表 → 既存テストどおり `rawBlock` で `> ` が混入しない。
- セル内のインラインマーク(`**b**`、`` `c` ``、`$x$`)が失われない。

---

### Task 4: serialize.ts に GFM パイプ表出力を足す

**Files:**

- Modify: `src/markdown/serialize.ts`
- Modify: `src/markdown/roundtrip.test.ts`

**Step 1 — セル文字列のレンダリング**

`MarkdownSerializerState` はセル単位の文字列を返す API を持たないので、セルごとに
**新しい `MarkdownSerializerState`** を作り(`serializer.nodes` / `serializer.marks`
は public)、セルの唯一の子である paragraph の inline だけを `renderInline` して
`state.out` を取り出す。`esc` は `serializeMarkdown` が張った prototype patch
(`safeEsc`)がそのまま効く。

取り出した文字列に `escapeTableCell`(Task 1)をかけて `|` と改行を潰す。

**Step 2 — 表の出力**

```
| h1 | h2 |
| --- | :-: |
| a | b |
```

デリミタ行は**ヘッダ行のセルの `alignment`** から作る
(`null → ---` / `left → :---` / `center → :---:` / `right → ---:`)。
桁揃えはしない(Prettier が整形する)。空のセルは空文字のまま出す。

防御的措置として、`colspan` / `rowspan` が 1 でないセルに出会った場合は
表全体を出力せず例外を投げる(黙って壊れた表を書き出すよりは保存を失敗させる
ほうが原則に沿う)。

> **追記(2026-08-10)**: 当初ここには「UI から結合を作れない以上到達しない
> はずだが」と書いていたが、これは誤りだった。ペースト経由で結合セルが
> ドキュメントに入り、その文書が保存不能になる。実際の対策は
> `editor/nodes/table.ts` の `transformPasted` で結合をほどくこと
> (PR #9・#10)。経路の数え上げは3周にわたって漏れ続けたので、
> 現在は宣言ではなく `table-paste.test.ts` の経路マトリクスで担保している。

**Step 3 — `tableRow` / `tableCell` / `tableHeader`**

`table` レンダラが行/セルを直接走査するため、これらは呼ばれない。ただし
`MarkdownSerializer` は全ノード型のハンドラを要求するので、到達不能を明示する
スタブ(例外を投げる)を登録する。

**検証:** Task 6 のゴールデンテストで往復と冪等を固定する。加えて単体で
`|` を含むセル・空セル・揃え指定つきの表を往復させる。

---

### Task 5: 表の編集 UI

**Files:**

- Create: `src/editor/nodes/table-view.ts`
- Modify: `src/editor/nodes/table.ts`, `src/editor/slash/items.ts`, `src/editor/editor.css`
- Modify: `src/editor/slash/items.test.ts`, `src/editor/nodeviews.test.tsx`

**Step 1 — スラッシュコマンド**

`/table`(keywords: `table`, `表`, `テーブル`)で
`insertTable({ rows: 3, cols: 3, withHeaderRow: true })`。

**Step 2 — NodeView**

`Table` に `addNodeView` を足し、`<div class="numenumd-table-wrap">` の中に
`<table>`(contentDOM)と操作 UI を置く:

- 右端の `+`(列追加 = `addColumnAfter`)と下端の `+`(行追加 = `addRowAfter`)。
  カーソルが表内にある間だけ表示する(`update` でエディタの selection を見て
  クラスを付け外しする)。
- 上端に列グリップ帯、左端に行グリップ帯。クリックでその列/行を `CellSelection`
  で選択する。選択中の Backspace / Delete は `deleteColumn` / `deleteRow`。
- グリップの数は列数/行数に追従させる(`update` で再構築)。
- 操作 UI は `contentEditable = 'false'`、`ignoreMutation` で ProseMirror に
  無視させる(既存の `math-block.ts` / `raw-block.ts` と同じ流儀)。

**Step 3 — CSS**

`editor.css` に表・`selectedCell`・グリップ・`+` ボタンのスタイル。
画面幅を超える表は wrapper 側で横スクロール(`overflow-x: auto`)。

**検証(`nodeviews.test.tsx`):** 表を含む doc をマウントし、
`+` ボタンのクリックで行/列が増えること、グリップのクリックで `CellSelection` に
なること、その状態の Backspace で行/列が消えることを DOM 経由で確認する。

---

### Task 6: フィクスチャとゴールデンテスト

**Files:**

- Create: `tests/fixtures/table.md`
- Modify: `src/markdown/roundtrip.test.ts`, `tests/fixtures/blocks.md`(必要なら)

**Step 1 — フィクスチャ**

`tests/fixtures/table.md` に、編集可能になる表と rawBlock 据え置きの表を両方入れる:

- 素の 2 列表
- 揃え指定つき(`:---` / `:---:` / `---:`)
- セル内にインラインマーク・インライン数式・エスケープされた `|`
- 空セルを含む行 / セル数が足りない行(→ 空セル補完される)
- **超過セルを持つ表**(→ rawBlock のまま。原文が1バイトも変わらないこと)
- blockquote 内の表
- HTML テーブル(→ 従来どおり rawBlock)

**Step 2 — 既存フィクスチャの期待値更新**

`tests/fixtures/blocks.md` の `## Table` 節は今回から table ノードになる。
ゴールデンの期待値がフィクスチャ自身(往復で不変)である以上、Prettier 整形済みの
現在の内容なら差分ゼロになるはずだが、実際に走らせて確認する。

**Step 3 — 冪等性**

全フィクスチャに対する既存の `format(format(x)) === format(x)` に table.md が
自動的に乗ることを確認する。

---

### Task 7: ドキュメントとバージョン

**Files:**

- Modify: `README.md`, `docs/smoke-checklist.md`

- README の「テーブル・生 HTML …は生 Markdown ブロックとして保全」の記述を、
  ハイブリッドの実態に合わせて書き直す。既知の制約に「セル結合は非対応」
  「超過セルを持つ表は生ブロックのまま」を足す。
- スモークチェックリストに表の項目(挿入・行列追加削除・保存後に再度開く)を追加。

**バージョンはこのブランチでは上げない。** 本ブランチは `main`(0.1.0)から
切っており、0.2.0 への引き上げは未マージのストア公開 PR #7 が持っている。ここで
0.3.0 にすると #7 と `package.json` / `manifest.config.ts` で衝突するうえ、
0.2.0 のリリース前に番号を飛ばすことになる。#7 のマージ後にリベースし、
そのタイミングで 0.3.0 へ上げる。

---

## 完了条件

- `npm test && npm run lint && npm run typecheck && npm run build` がグリーン。
- 上記フィクスチャの往復・冪等テストが通る。
- 超過セルを持つ表が1バイトも変わらずに保存されることをテストで固定。
- 独立 subagent レビューの承認(CLAUDE.md のマージゲート)。
