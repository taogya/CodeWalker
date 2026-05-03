# FEAT-002: Walkthrough Coverage Dashboard

- 優先度: 高

## Problem

`codewalker-all` や Manual 編集の結果は `.code-walker/` に蓄積されますが、どのファイルやシンボルが整備済みか、どこに stale なブロックがあるかを俯瞰する UI がありません。大きいプロジェクトでは整備状況の把握が難しくなります。

## User Value

- リポジトリ全体の walkthrough coverage を一目で把握できる
- Manual / Auto / stale / 未整備 を切り分けて次の作業対象を選べる
- 新規参入メンバー向けの onboarding 観点でも利用価値が高い

## Scope

- ワークスペース単位の coverage 集計ビューを追加する
- フォルダ、ファイル、シンボル単位で整備状況を表示する
- `targets.json`、`walks-manual/`、`walks-auto/`、`hashMismatch` 情報を統合表示する
- ダッシュボードから対象ファイルを開く、再解析する、compare を起動する導線を用意する

### Out Of Scope

- 複数ワークスペース横断の集計
- GitHub や外部サービスへの同期
- レビューコメントそのものの管理

## Proposed UX

1. `CodeWalker: Open Coverage Dashboard` コマンドで Webview または TreeView を開く
2. 画面上部に `Manual / Auto / Stale / Uncovered` の件数サマリを表示する
3. 一覧でファイルごとの coverage と stale 数を表示し、クリックで該当ファイルへ移動する
4. フィルタで `Manual only`, `stale only`, `recently updated`, `target pending` を切り替える

## Technical Outline

- キャッシュ集計専用サービスを新設し、`.code-walker` 配下を再帰読込する
- `compareWalkthroughs` の差分集計と `listSymbolsTool` の targets 情報を再利用する
- `BlockStore` のメモリ状態だけでなく、ディスク上の全キャッシュを source of truth とする
- stale 判定は既存の `blockHash` 検証結果を使い、必要なら手動再計算を提供する

## Test Strategy

- キャッシュのみ存在するケースで正しい件数が出る unit テスト
- pending / done / skip を含む `targets.json` を読み、coverage 指標が正しく計算されるテスト
- ダッシュボードからファイルオープンや比較起動ができる integration テスト
- stale のあるファイルだけを抽出できるフィルタテスト

## Open Questions

- TreeView と Webview のどちらが日常利用に向くか
- coverage の単位を `file` / `symbol` / `block` のどれで主表示するか
- `codewalker-all` 実行結果とリアルタイムに同期するか、都度再計算にするか