---
name: "CodeWalker レビュールール"
description: "docs/design/docs/reviews に CodeWalker の仕様バグ、仕様・コード不整合、コードバグを記録するときに使う。レビュー一覧と個別ファイルの書式を定義する。"
applyTo: "docs/design/docs/reviews/**"
---

# レビュールール

- レビューの索引は `docs/design/docs/reviews/README.md` で管理する。
- 個別レビューのファイル名は `REV-XXX_<slug>.md` とする。
- 指摘は `仕様バグ`、`仕様・コード不整合`、`コードバグ` に分類して記録する。
- 各レビュー文書には、短い要約、発見日、レビュー範囲、Findings テーブルを含める。
- 標準の Findings テーブルは `| # | 分類 | 深刻度 | 対象 | 問題 | 根拠 | 主因 | 推奨対応 |` を使う。
- 深刻度は `高 / 中 / 低` を使う。
- `根拠` には、具体的なファイル、設定、コマンド、テスト、ドキュメントを挙げる。
- 対応状況は個別レビューではなく `docs/design/docs/reviews/README.md` だけで管理する。
- 十分に立証できていない点は、確定不具合として断定せず open question 扱いにする。