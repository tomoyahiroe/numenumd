# 保存先の記憶(リロード後のピッカー再表示をなくす)Implementation Plan

**Goal:** 一度保存した `.md` は、タブをリロードしても保存先を選び直さずに
`Cmd+S` で上書きできるようにする。

**Spec:** `docs/superpowers/specs/2026-08-01-numenumd-design.md`「保存先の記憶」節
**MTG 議事録:** `docs/mtg/2026-08-09-save-handle-persistence.md`
**Branch:** `feat/remember-save-target`

## 背景

MVP は「永続状態を一切持たない」方針で、`FileController` はハンドルをメモリに
しか置いていない(`src/file/controller.ts:9` の "No state survives a
page/session reload — by design")。その結果リロードのたびにピッカーが出る。
利便性を優先してこの原則を**1点だけ**緩める、というのが MTG の決定。

## 調査済みの事実(headless Chrome + CDP で実測)

| 検証                                            | 結果                           |
| ----------------------------------------------- | ------------------------------ |
| `file://` で IndexedDB が開けるか               | 開ける                         |
| 別ディレクトリの `file://` ページと共有されるか | 共有される                     |
| Chrome プロセス再起動をまたぐか                 | またぐ                         |
| `location.origin` / `window.origin`             | `"file://"` / `"null"`(opaque) |

Chrome 122 以降、IndexedDB に保存した `FileSystemHandle` を取り出して
`requestPermission()` を呼ぶと、ファイルピッカーではなく三択の許可プロンプト
(今回のみ / 毎回許可 / 許可しない)が出る。ユーザージェスチャが必要なので
`Cmd+S` の中で呼ぶ。

**未確認:** `file://` は opaque origin なので「毎回許可」が本当に永続するかは
実機の許可 UI がないと分からない。効かなかった場合は保存のたびに許可ダイアログが
出る(それでもファイルを選び直すよりは良い)。Task 5 で実機確認する。

## Global Constraints

- 本文は保存しない。記録するのは保存先(ハンドル)と最終保存時刻だけ。
- 外部送信は引き続き一切行わない。
- 既存の全テスト・lint・typecheck・build をグリーンに保つ。
- マージゲート: CI グリーン + 独立 subagent レビュー。

---

### Task 1: ハンドルストア(IndexedDB)

**Files:**

- Create: `src/file/handle-store.ts`, `src/file/handle-store.test.ts`

**Step 1 — 実装**

```ts
export type RememberedTarget = {
  handle: FileSystemFileHandle;
  lastSavedMtime: number | null;
};

export interface HandleStore {
  get(path: string): Promise<RememberedTarget | null>;
  put(path: string, target: RememberedTarget): Promise<void>;
  clear(): Promise<void>;
}
```

IndexedDB(DB 名 `numenumd`、ストア `saveTargets`、キーはファイルパス)。
`FileSystemFileHandle` は構造化クローン可能なのでそのまま `put` できる。

**IndexedDB が使えない環境では黙って無効化する。** プライベートウィンドウや
将来のブラウザ変更で `indexedDB.open` が失敗しうる。記憶できないことは
機能低下であって障害ではない(従来どおりピッカーが出るだけ)ので、
例外を投げず「常に `null` を返すストア」にフォールバックする。

**Step 2 — テスト**

`fake-indexeddb` を dev 依存に足すか、`HandleStore` をインターフェースとして
インメモリ実装でテストする。**後者を採る**(依存を増やさず、`FileController`
側のテストにも同じダブルを使えるため)。IndexedDB 実装そのものは Task 5 の
実機確認でカバーする。

---

### Task 2: `FileController` を記憶対応にする

**Files:**

- Modify: `src/file/controller.ts`, `src/file/controller.test.ts`

**Step 1 — 記憶の読み出し**

コンストラクタに `path`(記憶のキー)と `HandleStore` を渡す。`save()` は
ハンドルが未取得のとき、まず記憶を引く:

1. `store.get(path)` でハンドルと `lastSavedMtime` を取り出す。
2. `handle.queryPermission({ mode: 'readwrite' })` が `'granted'` ならそのまま使う。
3. `'prompt'` なら `requestPermission({ mode: 'readwrite' })`。`'granted'` なら使う。
4. それ以外(拒否・例外・ファイルが消えている等)は**記憶を捨ててピッカーへ**。

`getFile()` が `NotFoundError` を投げる(移動・削除された)ケースもここで
ピッカーに落ちる。孤児レコードは次の保存成功時に上書きされる。

**Step 2 — 記憶の書き込み**

`write()` の成功後、`lastSavedMtime` を更新するのと同じ場所で
`store.put(path, { handle, lastSavedMtime })` する。保存に失敗した場合は
書かない(「保存に成功したファイルだけ覚える」という決定)。

**Step 3 — 外部変更検知の改善**

記憶から `lastSavedMtime` を復元することで、リロード後の初回保存でも
conflict チェックが効くようになる。従来は null でチェックを飛ばしていた。

**検証(`controller.test.ts`):**

- 記憶があり権限も `granted` なら、`showSaveFilePicker` を**呼ばずに**保存する。
- 記憶があるが権限が拒否されたら、ピッカーに落ちて新しいハンドルで記憶を上書きする。
- 記憶が無ければ従来どおりピッカー。
- 保存に失敗したら記憶しない。
- 記憶から復元した `lastSavedMtime` により、リロード後の初回保存で外部変更を
  検知して `'conflict'` を返す(**現状バグっている経路の回帰テスト**)。
- `handle.getFile()` が `NotFoundError` を投げたらピッカーに落ちる。

---

### Task 3: 呼び出し側の接続

**Files:**

- Modify: `src/content/App.tsx`(または `FileController` を組み立てている箇所)

記憶のキーは `location.pathname`(`picker-id.ts` がディレクトリ由来の id を
作っているのと同じ情報源)。`FileController` の生成箇所に `HandleStore` を渡す。

**検証:** 既存の App テストがグリーンのままであること。キーが実際に
`location.pathname` になっていることをテストで固定する。

---

### Task 4: オプションページ(記憶の消去)

**Files:**

- Create: `src/options/index.html`, `src/options/main.tsx`, `src/options/App.tsx`
- Modify: `manifest.config.ts`(`options_page`), `vite.config.ts`(入力に追加)

「記憶した保存先を全部消す」ボタン1つ。押すと `HandleStore.clear()` して
結果を表示する。記憶件数も出す(何が消えるのか分かるように)。

**注意:** オプションページは `chrome-extension://` オリジンで動くため、
`file://` オリジンの IndexedDB は**見えない**。消去は content script 側へ
`chrome.runtime` メッセージで依頼し、`file://` のページで実行する必要がある。
`.md` を開いているタブが1つも無い場合は消せないので、その旨を表示する。

> この制約は Task 1 の時点で実測して確認すること。もしオプションページから
> 直接消せないなら、代替として「エディタのヘッダに消去 UI を置く」案に
> 差し戻す判断が要る(MTG の決定を変えることになるのでユーザーに確認する)。

---

### Task 5: 実機確認

`docs/smoke-checklist.md` に項目を追加し、実際の Chrome で確認する。

1. `.md` を開いて保存 → タブをリロード → `Cmd+S` でピッカーが**出ない**こと。
2. 許可プロンプトが出る場合、「毎回許可」を選ぶと次回以降は出なくなるか
   (= opaque origin でも永続許可が効くか)。**保留になっている未確認事項。**
3. 記憶したファイルを別アプリで変更 → リロード後の初回 `Cmd+S` で競合警告が出ること。
4. ファイルを削除/リネーム → ピッカーに落ちること。
5. オプションページで消去 → 次の保存でピッカーが出ること。

---

### Task 6: ドキュメントとプライバシー

**Files:**

- Modify: `PRIVACY.md`, `docs/store-listing.md`, `README.md`

- `PRIVACY.md:7`「いかなる情報も収集・送信・保存しません」→ 収集・送信は維持し、
  保存について「どのファイルをどこへ保存したかを、この端末の中にだけ記録する」
  を明記する。本文は保存しないことも書く。消し方(オプションページ)も書く。
- `PRIVACY.md:32`「永続的な状態を持ちません」を同様に書き換える。
- `docs/store-listing.md:40`「状態はブラウザのタブと .md ファイルの中にしか
  ありません」を書き換える。
- README に保存先の記憶と消し方を書く。

---

## 完了条件

- `npm test && npm run lint && npm run typecheck && npm run build` がグリーン。
- リロード後の初回保存でピッカーが出ないことを実機で確認。
- リロード後の初回保存で外部変更を検知することをテストで固定。
- プライバシー文書が実態と一致している。
- 独立 subagent レビューの承認。
