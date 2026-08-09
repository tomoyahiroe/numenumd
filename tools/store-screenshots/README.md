# ストア掲載画像の生成ハーネス

Chrome ウェブストア用の画像を `docs/store-assets/` に生成する。

```bash
npm run build:store-assets
```

生成されるもの:

| ファイル                                        | サイズ   | 内容                                  |
| ----------------------------------------------- | -------- | ------------------------------------- |
| `docs/store-assets/screenshot-1-math.png`       | 1280×800 | 数式(KaTeX 描画)                      |
| `docs/store-assets/screenshot-2-blocks.png`     | 1280×800 | 見出し・リスト・引用・コード          |
| `docs/store-assets/screenshot-3-slash-menu.png` | 1280×800 | スラッシュメニューを開いた状態        |
| `docs/store-assets/screenshot-4-preserve.png`   | 1280×800 | frontmatter・テーブル・生 HTML の保全 |
| `docs/store-assets/screenshot-5-dark.png`       | 1280×800 | ダークテーマ                          |
| `docs/store-assets/promo-small-tile.png`        | 440×280  | 小さいプロモーション タイル           |

生成された PNG はコミットする。通常のビルド(`npm run build`)や CI は
このハーネスに一切依存しない。

## 構成

| ファイル                  | 役割                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `capture.mjs`             | ビルド → ローカル配信 → CDP で撮影 → `docs/store-assets/` へ出力 |
| `vite.config.ts`          | 撮影用ページのビルド設定(crx プラグインを外した2ページ構成)      |
| `index.html` / `main.tsx` | `src/content/App` をそのままマウントするページ                   |
| `docs/*.md`               | 撮影に使うサンプル文書(`?doc=<名前>` で切り替え)                 |
| `promo.html`              | プロモーション タイルのレイアウト                                |

## なぜ拡張機能そのものを撮らないのか

numenumd は `file:///*` の content script なので、実際に動かすには
`chrome://extensions` の「ファイルの URL へのアクセスを許可する」を人間が手で
ON にする必要がある。この設定は headless Chrome から有効化できない
(`--load-extension` で読み込んでも既定は OFF のままで、生の `<pre>` が写る)。

そのため、同じ `src/content/App` を普通のページとしてマウントしたハーネスを
撮っている。描画される UI と CSS は拡張機能本体とまったく同じものになる。

## なぜ CDP を使うのか

Chrome の `--screenshot` フラグでは次の 2 つができない。

- **テーマの固定**: headless Chrome の `prefers-color-scheme` の既定は dark で、
  CLI からは light を撮れない。`Emulation.setEmulatedMedia` なら確実に指定できる。
- **対話状態の撮影**: スラッシュメニューは `/` を打たないと出ない。
  `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent` で作ってから撮る。

## サンプル文書を足す / 変える

1. `docs/<名前>.md` を追加する。
2. `main.tsx` の `DOCS` に、表示するファイル名と一緒に登録する。
3. `capture.mjs` の `SPECS` に撮影スペックを追加する。

スペックで使えるキー: `name`(出力ファイル名)、`path`、`theme`
(`light` / `dark`)、`w` / `h`、`wait`(ms)、`actions`。
`actions` の要素は `{ clickEval }`(ページ内で `[x, y]` を返す式)、
`{ key }`(1 文字なら文字入力、`Enter` などは名前付きキー)、`{ after }`(待ち ms)。

> ウェブストアが受け付けるスクリーンショットは **1280×800 か 640×400 のみ**、
> 小さいプロモーション タイルは **440×280 のみ**。ここから外れるとアップロード
> 時に弾かれる。
