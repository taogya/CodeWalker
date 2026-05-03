# CodeWalker プロジェクトガイドライン

## プロジェクトの前提

- このリポジトリは、対話型コードウォークスルーのための VS Code 拡張です。
- ユーザー向けの振る舞いは `README.md`、`docs/design/docs/01-overview.md` から `docs/design/docs/07-usecases.md`、および `docs/design/docs/99-status.md` に記録されています。
- 既存のスラッシュプロンプト `.github/prompts/codewalker.prompt.md` と `.github/prompts/codewalker-all.prompt.md` は製品の主フローです。ツール契約を変えるタスクでない限り、書き換えや削除をしないでください。
- `codewalker*.prompt.md` を意図的に変更する場合は、`sample_project/.github/prompts/` と `src/test/fixtures/.github/prompts/` にある対応ファイルも同期してください。

## アーキテクチャ

- `src/extension.ts` は構成と配線に集中させ、依存注入、登録、ライフサイクル管理だけを担わせてください。
- 表示中ブロックと解説の正本は `src/walker/blockStore.ts`、装飾状態だけを持つのは `src/walker/highlighter.ts` です。追加、編集、削除、クリアのフローを変えるときは両方を一緒に更新してください。
- キャッシュは `.code-walker/walks-manual/` と `.code-walker/walks-auto/` に保存されます。優先順位はファイル単位ではなくシンボル単位で Manual が優先です。
- `BlockStore.setBlocks()` を呼ぶときは、`source` に `manual` か `auto` を必ず明示してください。
- 設定定義の正本は `package.json` です。ユーザー向け設定を変えるときは、`README.md` と `docs/design/docs/06-settings.md` も整合させてください。
- TypeScript で新しいユーザー向け文字列を追加するときは `@vscode/l10n` を使ってください。contribution 文字列は `package.nls.json` と `package.nls.ja.json` に置いてください。

## ビルドとテスト

- `npm run compile`
- `npm run test:unit`
- `npm run pretest:integration && npm run test:integration`
- Unit テストは `src/test/unit`、Integration テストは `src/test/integration`、fixture は `src/test/fixtures` にあります。

## ドキュメント運用

- 確認済みの不具合や不整合は `docs/design/docs/reviews/` に記録し、一覧は `docs/design/docs/reviews/README.md` を更新してください。
- 将来機能の提案は `docs/design/docs/additional-spec/` に記録し、一覧は `docs/design/docs/additional-spec/README.md` を更新してください。
- 明示的に doc 修正を求められていない限り、既存設計書を書き換えるよりも review 文書や proposal 文書の追加を優先してください。