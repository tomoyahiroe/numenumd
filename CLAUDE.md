# numenumd プロジェクトルール

## コマンド

- テスト: `npm test` / lint: `npm run lint` / 型: `npm run typecheck` / ビルド: `npm run build`

## マージゲート(必須)

PR をマージする前に、必ず**このセッションの文脈を共有しない新規 subagent** に
レビューさせること。subagent には以下を依頼する:

1. PR ブランチを checkout し `npm test && npm run lint && npm run typecheck && npm run build` を実行
2. spec(docs/superpowers/specs/)・plan(docs/superpowers/plans/)との整合を確認
3. テストの実在性(アサーションが本当に仕様を検証しているか)と diff 品質をレビュー
   マージ条件は **CI グリーン + この独立レビューの承認** の両方。承認後に `gh pr merge`。

## 原則

- ユーザーの Markdown を絶対に失わない(変換不能記法は rawBlock で往復)
- **保存先の記憶以外の**永続状態を持たない。編集内容そのものは .md ファイルと
  タブのメモリにしか置かない。唯一の例外は「どのファイルをどこへ保存したか」の
  記憶(`FileSystemFileHandle` と最終保存時刻)で、リロードのたびに保存先を
  選び直す体験を避けるために IndexedDB へ置く。例外はこれ1つに限る
  (経緯: `docs/mtg/2026-08-09-save-handle-persistence.md`)
- main へ直接 push しない
