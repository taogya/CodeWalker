---
name: "CodeWalker 将来機能ルール"
description: "docs/design/docs/additional-spec に CodeWalker の将来機能提案を書くときに使う。一覧管理、仕様構成、既存アーキテクチャとの整合の観点を定義する。"
applyTo: "docs/design/docs/additional-spec/**"
---

# 将来機能ルール

- 機能提案の索引は `docs/design/docs/additional-spec/README.md` で管理する。
- 個別提案のファイル名は `FEAT-XXX_<slug>.md` とする。
- 将来機能の仕様は、新しい価値を作る機能に限定する。現行不具合の整理は `docs/design/docs/reviews/` に記録する。
- 各提案文書には `Problem`、`User Value`、`Scope`、`Proposed UX`、`Technical Outline`、`Test Strategy`、`Open Questions` を含める。
- 必要に応じて、`BlockStore`、`highlighter`、`CacheService`、`restoreCache`、`listSymbolsTool`、`compareWalkthroughs`、既存プロンプトとの関係を明記する。
- 提案が `.code-walker` のデータ構造、ユーザー向けコマンド、プロンプトフローを変えるかどうかを明示する。
- 既存の `codewalker` と `codewalker-all` の流れに無理なく共存できる、段階導入しやすい提案を優先する。