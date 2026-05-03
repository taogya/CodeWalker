---
description: "CodeWalker に最適な将来機能を抽出し、docs/design/docs/additional-spec に提案仕様として記録する"
argument-hint: "提案したい方向性や対象範囲を入力"
agent: "agent"
---

# CodeWalker Feature Check

CodeWalker の現行アーキテクチャと docs を踏まえ、将来価値の高い機能を選定して `docs/design/docs/additional-spec/` に仕様として残してください。

## 対象

- `README.md`
- `docs/design/docs/01-overview.md` から `docs/design/docs/07-usecases.md`
- `docs/design/docs/99-status.md`
- `package.json`
- `src/`
- `src/test/`

## 優先する方向

1. ウォークスルー資産の鮮度維持
2. プロジェクト全体での運用しやすさ
3. チーム共有やレビューとの接続
4. 既存の `codewalker` / `codewalker-all` フローを活かせる拡張性

## 実行ルール

1. 現在の不具合修正は feature proposal に混ぜず、必要なら `docs/design/docs/reviews/` に分離すること
2. `docs/design/docs/additional-spec/README.md` と個別 `FEAT-XXX_*.md` を更新すること
3. 既存の `codewalker*.prompt.md` は維持し、変更が必要なら理由を明示すること
4. 機能案は 1 つに絞り込んでもよいが、複数ある場合は優先度を付けること

## 出力

- 採用した feature proposal 一覧
- 各提案の狙いと優先度
- 追加または更新した `docs/design/docs/additional-spec/` ファイル名