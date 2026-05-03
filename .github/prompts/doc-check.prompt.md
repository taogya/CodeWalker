---
description: "CodeWalker のドキュメント、実装、テスト、設定の整合性を監査し、confirmed findings を docs/design/docs/reviews に記録する"
argument-hint: "レビューしたい範囲や補足条件を入力"
agent: "agent"
---

# CodeWalker Doc Check

CodeWalker のドキュメントと実装の整合性を確認し、確認できた問題を `docs/design/docs/reviews/` に記録してください。

## 対象

- `README.md`
- `docs/design/docs/01-overview.md` から `docs/design/docs/07-usecases.md`
- `docs/design/docs/99-status.md`
- `package.json`
- `src/`
- `src/test/`
- `media/`
- `l10n/`

## 確認観点

1. `package.json` で公開している設定・コマンド・ツールと README / docs の記述が一致しているか
2. `walks-manual` / `walks-auto` / `BlockStore` / `highlighter` の振る舞いが docs の説明と一致しているか
3. Manual / Auto の優先順位、削除、クリア、復元、比較の各フローに取りこぼしがないか
4. `src/test/` のテスト内容と `docs/design/docs/07-usecases.md` / `docs/design/docs/99-status.md` の説明が大きくずれていないか
5. 仕様バグ、仕様・コード不整合、コードバグを区別して記録できるか

## 実行ルール

1. 既存の `codewalker*.prompt.md` は壊さないこと。必要性が明示されない限り編集しないこと
2. confirmed finding のみ `docs/design/docs/reviews/` に記録すること
3. `docs/design/docs/reviews/README.md` の一覧も更新すること
4. 可能なら `npm run compile` と関連テストで事実確認してから記録すること
5. 既存 docs の修正は、このプロンプトでは行わずレビュー記録までに留めること

## 出力

- 追加または更新した review ファイル名
- 重要度順の findings 要約
- 実行した検証コマンドと、その結果の要点