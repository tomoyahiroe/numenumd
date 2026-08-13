# math block の削除手段と1行 `$$…$$` の描画 Implementation Plan

**Goal:** (1) math block をマウスだけで削除できるようにする。(2) 1行で書かれた
`$$Y = X + a$$` をブロック数式として描画し、保存時も1行のまま書き戻す。

**Spec:** `docs/superpowers/specs/2026-08-01-numenumd-design.md`「数式」
**MTG 議事録:** `docs/mtg/2026-08-13-math-block-fixes.md`
**Branch:** `fix/math-block-delete-and-single-line-fence`

## 背景(調査済みの事実)

実際に parse とエディタを走らせて確認した結果:

| 入力                       | 現状の結果         |
| -------------------------- | ------------------ |
| `$$Y = X + a$$`            | 段落テキスト(❌)   |
| `$$ Y = X + a $$`          | 段落テキスト(❌)   |
| `$$`⏎`Y = X + a`⏎`$$`      | mathBlock(✅)      |
| `$$`⏎`Y = X + a`(閉じ無し) | mathBlock(✅)      |
| `foo $$Y = X + a$$ bar`    | 段落テキスト(保留) |
| 4スペースインデントの `$$` | codeBlock          |

- **描画されない条件は「`$$` と `$$` が同じ行にあるか」。** `parse.ts:38` の
  `if (state.src.slice(start + 2, max).trim().length > 0) return false;` が開き行の
  残りを空白のみに限定しており、インライン側も `math-spans.ts:40` が `$$` 隣接を
  明示的に除外するため、1行 `$$…$$` はどちらにも拾われず素のテキストになる。
  エディタで直接打った場合も入力ルールが `/^\$\$\s$/` のみなので同じ。
- **削除できない原因は NodeView の `stopEvent: () => true`(`math-block.ts:201`)。**
  ProseMirror が math block 上の mousedown/click を受け取れず、マウスでノードを
  選択する手段が無い。クリックは NodeView 自身のリスナが拾って編集モードに入るだけ。
- **textarea を空にして抜けると空の mathBlock が不可視の帯として残る。**
  `.numenumd-math-block` は `padding: 8px 4px` のみで枠線も文字もないため高さ 16px の
  透明な帯になり、クリックすら困難になる。
- キーボード経路(直後の段落で Backspace)だけは動く。段落に文字があれば1回、
  空段落なら2回(1回目でノード選択)。ただしそれを示す表示は何もない。

## Global Constraints

- ユーザーの Markdown を絶対に失わない。1行で書かれた数式は1行のまま書き戻す。
- インライン数式 `$…$` の検出規則(`math-spans.ts`)は**変更しない**。表示系と
  保存系が同じ規則を共有している構造を壊さないため。
- `rawBlock` / `frontmatter` は今回触らない(MTG で対象外と決定)。
- 既存の全テスト・lint・typecheck・build をグリーンに保つ。
- マージゲート: CI グリーン + 独立 subagent レビュー。main へ直接 push しない。

---

### Task 1: 1行 `$$…$$` をパースする

**Files:**

- Modify: `src/markdown/parse.ts`, `src/markdown/parse.test.ts`
- Modify: `src/editor/nodes/math-block.ts`(属性追加のみ)

**Step 1 — スキーマに「1行だった」印を足す**

`MathBlock.addAttributes()` に `singleLine: { default: false }` を追加する。
`renderHTML` / `parseHTML` にも `data-single-line` として載せる(コピー&ペーストの
往復でも印が保たれるようにする)。

**Step 2 — `mathBlockRule` を拡張**

開き行の `$$` の後ろが空白のみ、という現在の条件に「後ろが `$$` で終わる」経路を
足す。ざっくり:

```ts
const rest = state.src.slice(start + 2, max).trimEnd();
if (rest.length > 0) {
  // 1行完結形。`$$…$$` の形でなければ従来どおり不成立。
  if (!rest.endsWith('$$')) return false;
  if (silent) return true;
  state.line = startLine + 1;
  const token = state.push('math_block', '', 0);
  token.content = rest.slice(0, -2);
  token.markup = '$$';
  token.meta = { singleLine: true };
  token.map = [startLine, state.line];
  return true;
}
// 以降は既存の複数行経路(変更なし)
```

`buildTokenMap()` の `math_block` の `getAttrs` を
`{ latex: tok.content.trim(), singleLine: tok.meta?.singleLine === true }` にする。

**検証(`parse.test.ts`):**

- `$$Y = X + a$$` → `mathBlock({ latex: 'Y = X + a', singleLine: true })`
- `$$ Y = X + a $$` → 同上(trim される)
- `$$`⏎`Y = X + a`⏎`$$` → `singleLine: false`(既存挙動の回帰テスト)
- `$$x$` / `$$x$$y` → 段落のまま(部分一致で誤爆しないこと)
- `$$$$` → 空の mathBlock
- `foo $$x$$ bar` → 段落のまま(行頭 `$$` のみ対象、という保留事項の固定)

---

### Task 2: 1行のまま書き戻す

**Files:**

- Modify: `src/markdown/serialize.ts`, `src/markdown/roundtrip.test.ts`

`mathBlock` レンダラを分岐させる:

```ts
mathBlock: (state, node) => {
  const latex = node.attrs.latex as string;
  if (node.attrs.singleLine && !latex.includes('\n')) {
    state.write('$$' + latex + '$$');
    state.closeBlock(node);
    return;
  }
  // 既存の3行出力(変更なし)
};
```

**改行を含む latex は必ず3行に落とす。** `singleLine` が立ったまま複数行の latex を
1行で書き出すと、再パースで別物になり往復が壊れるため(編集で改行を足した場合に
実際に起きる)。

**検証(`roundtrip.test.ts`):**

- `$$Y = X + a$$\n` → parse → serialize が入力と一致する(冪等)
- `$$`⏎`Y = X + a`⏎`$$`⏎ → 3行のまま(既存挙動の回帰テスト)
- `singleLine: true` かつ latex に改行を含む doc → 3行で出力される
- 1行と複数行が混在した文書がそれぞれの形を保つ

---

### Task 3: エディタで `$$x$$` と打った場合の入力ルール

**Files:**

- Modify: `src/editor/nodes/math-block.ts`, `src/editor/extensions.test.ts`

既存の `/^\$\$\s$/`(`$$` + スペース)に加えて、1行完結形のルールを足す。

**`nodeInputRule` は使えない**(実装中に判明)。`nodeInputRule` はキャプチャ
グループがあると「マッチ部分だけをインラインノードへ差し替える」経路
(`tr.insertText(lastChar, …)` + `tr.replaceWith(matchStart, end, node)`)に入る。
これはメンションや絵文字のようなインラインノード向けで、ブロックノードに使うと
段落の中にブロックを差し込む形になり位置が壊れる(`RangeError: Position out of
range` で実際に落ちた)。素の `InputRule` で段落まるごとを置き換える:

```ts
new InputRule({
  find: /^\$\$([^$\n]+)\$\$$/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from);
    const tail = $from.parent.textBetween(
      range.to - $from.start(),
      $from.parent.content.size,
    );
    if (tail.length > 0) return; // カーソルの後ろに文字が残る段落は対象外
    chain()
      .command(({ tr }) => {
        tr.replaceWith(
          $from.before(),
          $from.after(),
          this.type.create({ latex: match[1] ?? '', singleLine: true }),
        );
        return true;
      })
      .run();
  },
});
```

`find` は行頭からカーソル位置までしか見ないため、カーソルの後ろに文字が残っている
段落がありうる。段落ごと置き換える以上、ガード無しではその文字が無警告で消える。

latex は既に入っているので `markNextMathBlockForEdit()` は**呼ばない**
(編集モードで開かず、そのまま描画する)。

**検証(`shortcuts.test.ts`):** `$$Y = X + a$` が入った段落に閉じの `$` を打つと
`mathBlock({ latex: 'Y = X + a', singleLine: true })` になること。カーソルの後ろに
文字が残っている場合は変換されず、その文字も消えないこと。既存の `$$` + スペース /
`$$` + Enter の経路が壊れていないこと。

---

### Task 4: 空 textarea で Backspace → ノード削除

**Files:**

- Modify: `src/editor/nodes/math-block.ts`, `src/editor/nodeviews.test.tsx`

`renderEdit` の keydown ハンドラに追加:

```ts
if ((ev.key === 'Backspace' || ev.key === 'Delete') && textarea.value === '') {
  ev.preventDefault();
  done = true; // ← dispatch より先に立てる
  deleteSelf();
  return;
}
```

**`done = true` を dispatch の前に立てるのが必須。** ノードを消すと NodeView が
破棄されて textarea が DOM から外れ blur が発火する。先に立てておかないと
`finish(false)` が走り、既に存在しない位置に `setNodeMarkup` しようとする。

`deleteSelf` は `getPos()` で得た範囲を消し、カーソルを削除位置へ置く:

```ts
const deleteSelf = () => {
  if (typeof getPos !== 'function') return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  const size =
    editor.view.state.doc.nodeAt(pos)?.nodeSize ?? currentNode.nodeSize;
  editor
    .chain()
    .command(({ tr }) => {
      tr.delete(pos, pos + size);
      tr.setSelection(
        TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))),
      );
      return true;
    })
    .focus()
    .run();
};
```

**検証(`nodeviews.test.tsx`):**

- 中身がある状態で Backspace → **削除されない**(通常の文字削除として扱われる)
- 中身を空にして Backspace → mathBlock が doc から消える
- Delete でも同様に消える
- math block が唯一のブロックのケースで消しても doc が壊れず、カーソルが置かれる
- 削除後に blur が発火しても例外が出ない(`done` フラグの回帰テスト)

---

### Task 5: 空の math block にプレースホルダを出す

**Files:**

- Modify: `src/editor/nodes/math-block.ts`, `src/editor/editor.css`,
  `src/editor/nodeviews.test.tsx`

`renderDisplay` で latex が空(trim して空)なら KaTeX を呼ばずプレースホルダを出す:

```ts
if (currentNode.attrs.latex.trim() === '') {
  const empty = document.createElement('span');
  empty.className = 'numenumd-math-block-empty';
  empty.textContent = '空の数式ブロック';
  container.appendChild(empty);
} else {
  katex.render(/* 既存 */);
}
```

CSS は `--nd-muted` の文字色 + 破線の枠で、本文と区別しつつクリック領域を確保する。

**空でも自動削除はしない。** 元から `$$`⏎⏎`$$` を含むファイルがありうるため
(MTG 決定 / 「ユーザーの Markdown を絶対に失わない」原則)。

**検証:**

- `latex: ''` の mathBlock がプレースホルダを描画し、`.katex` を出さないこと
- プレースホルダをクリックすると従来どおり編集モードに入ること
- 既存テスト「読み込み時に存在する空 math block はフォーカスを奪わない」が
  グリーンのままであること

---

### Task 5.5: `listItem` の空段落を書き出さない(独立レビュー後に追加)

**Files:**

- Modify: `src/markdown/serialize.ts`, `src/markdown/roundtrip.test.ts`
- Create: `tests/fixtures/list-blocks.md`

独立レビューで、`- $$a = b$$` を含むファイルが**開いて保存するだけ**で壊れることが
判明した(`-` の空項目 + 数式が項目の外へ飛び出す。しかも2項目以上あると冪等でも
なくなる)。原因は3段:

1. Task 1 の1行完結形の分岐がリスト項目のマーカー行でも発火し、トークン列が
   `list_item_open → math_block → list_item_close` になる。
2. `listItem` のスキーマは `paragraph block*` なので `createAndFill` が
   **元の Markdown に無い空の `paragraph`** を先頭へ挿入する。
3. `listItem` レンダラがそれを書き出すと「空行で始まるリスト項目」になり、
   CommonMark ではそれは空の項目なので後続ブロックが項目の外へ出る。

3 は `main` に既存のバグ(` - ```code``` ` / `- > quote` / リスト内の3行数式が
同じ壊れ方をする)だが、この PR は `- $$x$$` という一般的な入力を新たにその経路へ
流し込む。`listItem` レンダラで「先頭が空段落 かつ 後続ブロックあり」のときだけ
その空段落を飛ばす:

```ts
const first = node.firstChild;
if (
  node.childCount > 1 &&
  first?.type.name === 'paragraph' &&
  first.content.size === 0
) {
  node.forEach((child, _offset, index) => {
    if (index > 0) state.render(child, node, index);
  });
  return;
}
state.renderContent(node);
```

空段落を飛ばすと `state.write` の `flushClose` が走らないため、後続ブロックが
マーカー行に直接乗り `- $$x$$` がそのまま往復する。項目が空段落**だけ**で
できている(`-` だけの空項目)場合は手を出さない。

**検証:** `tests/fixtures/list-blocks.md` を新設し `BYTE_STABLE_FIXTURES` に
登録する(既存の harness が冪等性 + バイト一致の両方を見る)。収録する形:
`- $$x$$` / `1. $$x$$` / ` - ```code``` ` / `- > quote` / リスト内3行数式 /
ネスト `- - $$x$$` / 通常のリスト / 複数段落の項目 / `- [ ] $$x$$`。

---

### Task 6: 実機確認

`docs/smoke-checklist.md` に項目を追加し、実際の Chrome で確認する。

1. `$$Y = X + a$$` を1行で含む `.md` を開くと数式として描画される。
2. そのまま `Cmd+S` で保存しても1行のままで、差分が出ない。
3. 数式ブロックをクリック → 全消し → Backspace でブロックが消える。
4. 空のまま抜けたブロックがプレースホルダとして見えており、クリックできる。
5. 段落で `$$x$$` と打つと数式ブロックになる。

---

## 完了条件

- `npm test && npm run lint && npm run typecheck && npm run build` がグリーン。
- 1行 `$$…$$` が描画され、保存しても1行のままであることを往復テストで固定。
- 空 textarea + Backspace で削除できることをテストで固定。
- 空の math block が不可視にならないことをテストで固定。
- 独立 subagent レビューの承認。
