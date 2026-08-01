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
- 永続状態を持たない(状態は .md ファイルとタブのメモリのみ)
- main へ直接 push しない
