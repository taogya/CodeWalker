# CodeWalker Additional Specs

将来機能の提案仕様をまとめるディレクトリです。現行バージョンのバグ修正ではなく、次の価値を作る拡張案だけを置きます。

| ID | ファイル | 優先度 | 狙い | 状態 |
|---|---|---|---|---|
| FEAT-001 | `FEAT-001_symbol-drift-repair.md` | 高 | 既存ウォークスルー資産をコード変更後も再利用しやすくする | 初期実装（preview 一部対応） |
| FEAT-002 | `FEAT-002_walkthrough-coverage-dashboard.md` | 高 | リポジトリ全体での整備状況と stale 状態を俯瞰できるようにする | 提案 |
| FEAT-003 | `FEAT-003_change-scoped-review-pack.md` | 中 | 変更差分に絞ったウォークスルー共有とレビュー準備を効率化する | 提案 |
| FEAT-004 | `FEAT-004_walkthrough-explorer-sidebar.md` | 高 | 左タブ起点でファイル、シンボル、ブロック、stale 状態を横断できるようにする | 初期実装 |
| FEAT-005 | `FEAT-005_symbol-graph-canvas.md` | 中 | シンボルやブロックの関係をグラフとして可視化する | 初期実装 |
| FEAT-006 | `FEAT-006_walkthrough-timeline-view.md` | 中 | ウォークスルーの更新履歴や比較結果を時系列 UI で追えるようにする | 初期実装 |
| FEAT-007 | `FEAT-007_taxonomy-and-quality-linting.md` | 高 | ラベルや解説品質をチームで揃え、整備漏れを減らす | 提案 |
| FEAT-008 | `FEAT-008_notification-auto-dismiss.md` | 中 | 非対話通知を数秒で自動的に閉じ、作業の邪魔になりにくくする | 実装済 |
| FEAT-009 | `FEAT-009_block-detail-navigation-sync.md` | 中 | Block Detail の Prev/Next とエディタ表示位置を同期し、文脈を見失いにくくする | 実装済 |

## Prioritization Notes

- FEAT-001 は現行の `blockHash` 警告を実用的な修復体験に変えるため、最優先です。
- FEAT-002 はチーム運用時の visibility を高め、`codewalker-all` の活用範囲を広げます。
- FEAT-003 は既存の `compareWalkthroughs` と相性が良く、レビュー用途への展開を自然に行えます。
- FEAT-004 は「左タブに常設したい」という要望に最も直結する提案です。
- FEAT-005 と FEAT-006 は、CodeWalker を単なる注釈表示から、関係理解と履歴理解のツールに広げる UI 案です。
- FEAT-007 は UI に依存せず、共有運用で崩れやすいラベル粒度や解説品質を揃える基盤案です。
- FEAT-008 は既存フローを変えずに通知ノイズを下げる小さな UX 改善で、他 FEAT と独立して段階導入できます。
- FEAT-009 は既存の Block Detail Panel を活かした小さな操作改善で、キャッシュ形式やプロンプト契約を変えずに導入できます。