# numenumd

ローカルディスク上の `.md` ファイルを Chrome で開くと、そのまま Notion 風の
WYSIWYG エディタとして編集できる Manifest V3 拡張機能。サーバーやアカウントは
不要で、状態はブラウザのタブと `.md` ファイル自身にしか持たない。編集内容は
Prettier で整形した Markdown として、開いたファイルへ直接上書き保存される。

## 開発コマンド

```bash
npm install       # 依存関係のインストール(初回のみ)
npm run dev       # Vite 開発サーバー(HMR 付きでの拡張機能開発)
npm run build     # 型チェック(tsc --noEmit) + 本番ビルド → dist/
npm test          # vitest によるテスト一括実行
npm run test:watch  # vitest をウォッチモードで実行
npm run lint      # eslint src
npm run typecheck # tsc --noEmit
npm run format    # prettier --write .(*.ts/tsx/css/md/json/yml 全体)
```

コミット時は husky + lint-staged により、ステージされた `*.ts`/`*.tsx` に対する
`eslint --fix` + `prettier --write`、`*.css`/`*.md`/`*.json`/`*.yml` に対する
`prettier --write` が自動実行される。

## インストール(開発版を手元で読み込む)

1. `npm run build` を実行し、`dist/` にビルド成果物を生成する。
2. Chrome で `chrome://extensions` を開く。
3. 右上の「デベロッパーモード」トグルを ON にする。
4. 「パッケージ化されていない拡張機能を読み込む」ボタンをクリックし、生成された
   `dist/` フォルダを選択する。
5. 読み込まれた「numenumd」のカードで「詳細」を開き、下部にある
   「ファイルの URL へのアクセスを許可する」のトグルを ON にする。
   - numenumd は `file:///*` にマッチする content script として実装されており、
     この設定が OFF のままだとローカルファイル上で一切動作しない。
6. 任意の `.md` ファイルを `file://` で開くと、numenumd の WYSIWYG エディタに
   置き換わる(`.md` 以外の `file://` ページは素通しされ、何も変わらない)。

拡張機能を更新した場合は、`npm run build` の後に `chrome://extensions` の
numenumd カードにある更新(circular arrow)アイコンを押すか、いったん削除して
読み込み直す。

## リリース手順

1. `package.json` の `"version"` を更新する。
2. 変更をコミットし、`vX.Y.Z`(`package.json` のバージョンと一致させる)形式の
   git タグを作成して push する。

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. push をトリガーに GitHub Actions の `Release` ワークフロー(`.github/workflows/release.yml`)
   が起動する。
   - タグ名と `package.json` の `version` が一致するかを検証してから
     `npm test` → `npm run build` を実行し、`dist/` を zip 化して
     アーティファクトとして保存する。
   - 続く公開ジョブは、Chrome Web Store 連携用の GitHub Secrets
     (`CWS_CLIENT_ID` など)が設定されていれば `chrome-webstore-upload-cli` で
     Chrome Web Store へ自動アップロード・公開する。
   - **Secrets が未設定の場合は公開ジョブが自動的にスキップされる**(ビルドと
     zip 化までは常に実行される)ため、ストア未登録の段階でもリリースタグの
     push 自体は安全に行える。
   - Secrets のセットアップ手順(Chrome Web Store デベロッパー登録、OAuth
     クライアントの作成、GitHub Secrets への登録項目)は
     [`docs/superpowers/specs/2026-08-01-numenumd-design.md`](docs/superpowers/specs/2026-08-01-numenumd-design.md)
     の「Chrome Web Store 自動デプロイ(CD)」節を参照。

## 主な機能

- `# `〜`###### `、`- `、`1. `、`[] `/`[x] `、`> `、` ``` `、`$$` + Enter といった
  入力オートフォーマット。
- `Cmd+B`(太字)/`Cmd+I`(斜体)/`Cmd+E`(インラインコード)/`Cmd+Shift+X`
  (取り消し線。StarterKit 既定の `Cmd+Shift+S` も併用可)/`Cmd+K`(リンク)/
  `Cmd+Alt+1`〜`Cmd+Alt+6`(見出し1〜6)/`Cmd+S`(保存)。
- `/` から始まるスラッシュメニュー(Heading 1〜3、Bulleted/Numbered/To-do list、
  Quote、Code block、Math block。日本語キーワードでの絞り込みにも対応)。
- インライン数式 `$…$`(Pandoc 方式のペア判定ヒューリスティックで地の文中の `$`
  記号と区別)とブロック数式 `$$…$$` の KaTeX レンダリング、クリックでの編集。
  数式ブロックの LaTeX 編集中は `Escape` または `Cmd+Enter` で確定し、
  カーソルが直後の段落へ移動する(段落が無ければ自動で作られる)。
- テーマ切り替え: ヘッダ右上のボタンで Auto(OS 設定に追従)/ Light / Dark を
  循環。永続化はしない設計のため、選択はタブごとにリセットされる。
- テーブル・生 HTML・リンク参照定義など WYSIWYG に変換できない記法は、内容を
  一切変更せず生 Markdown ブロックとして保全して表示する。
- frontmatter(先頭の `---` 区切り YAML)は折りたたみ UI で表示し、保存時も
  Prettier 整形の対象外として verbatim のまま書き戻す。
- 保存はファイルごとに初回だけ OS のファイル保存ピッカーが開き(ファイル名は
  プリセット済み)、以降は無音で上書き保存する。エディタ外にフォーカスがある
  状態でも `Cmd+S` を横取りする。外部アプリで同じファイルが変更されていた場合は
  上書き前に競合確認ダイアログを出す。

詳しい設計は
[`docs/superpowers/specs/2026-08-01-numenumd-design.md`](docs/superpowers/specs/2026-08-01-numenumd-design.md)、
リリース前の手動確認手順は [`docs/smoke-checklist.md`](docs/smoke-checklist.md)
を参照。

## 既知の制限 / TODO

- 拡張機能アイコン(`manifest` の `icons`)が未整備で、`chrome://extensions` や
  ツールバー上ではデフォルトのプレースホルダーアイコンのまま表示される。
- Vim 風モーダル編集などの Phase 2/3 機能は MVP のスコープ外(`KeyRouter` は
  将来の拡張を見越した設計のみ済み)。
