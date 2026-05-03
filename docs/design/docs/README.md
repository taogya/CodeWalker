# CodeWalker 設計ドキュメント

> 最終更新: 2026-04-28

## ドキュメント一覧

| # | ファイル | 内容 |
|---|---|---|
| 01 | [概要・アーキテクチャ](./01-overview.md) | 設計原則、主要ディレクトリ構成、登録コマンド / views / tools、主要フロー |
| 02 | [ツール設計](./02-tools.md) | 6 ツールの入出力・副作用 |
| 03 | [UI コンポーネント](./03-ui.md) | カラーパレット、CodeLens、Sidebar、Webview、Graph / Timeline |
| 04 | [キャッシュ・エクスポート](./04-cache.md) | フォルダ構造、JSON スキーマ、復元ロジック、stale repair、ハッシュ検知 |
| 05 | [マニュアルモード](./05-manual-mode.md) | 手動ブロック定義、編集 Webview、Auto/Manual 分離、stale repair との関係 |
| 06 | [設定リファレンス](./06-settings.md) | VS Code Settings の全項目・デフォルト値 |
| 07 | [ユースケース一覧](./07-usecases.md) | 現行テストスイートと手動確認済みフローの一覧 |
| 99 | [実装状況・課題](./99-status.md) | Phase 別進捗、未実装・保留事項 |

## 補助ドキュメント

| ディレクトリ | 内容 |
|---|---|
| [additional-spec/](./additional-spec/README.md) | 将来機能の提案仕様と実装状態 |
| [reviews/](./reviews/README.md) | 仕様・実装不整合やレビュー findings の記録 |

## 図の生成

```bash
bash scripts/render-diagrams.sh
```

Mermaid ソース: `docs/design/docs/resources/diagram/*.mmd`
出力先: `docs/design/docs/resources/images/*.svg`
