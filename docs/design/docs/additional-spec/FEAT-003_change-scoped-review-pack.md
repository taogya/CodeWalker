# FEAT-003: Change-Scoped Review Pack

- 優先度: 中

## Problem

現在の CodeWalker は単一シンボル解説やプロジェクト一括解析には強い一方で、「今回の変更差分だけをまとめて理解する」レビュー向けフローが弱いです。`compareWalkthroughs` は存在しますが、変更ファイル起点で walkthrough を束ねる体験にはなっていません。

## User Value

- PR やレビュー対象に絞った walkthrough 生成ができる
- 変更の背景と影響を Markdown で共有しやすくなる
- `codewalker-all` を毎回フル実行しなくても、変更点に集中できる

## Scope

- changed files ベースで対象を絞る review pack 生成フローを追加する
- 選択したファイル群に対して walkthrough 生成または差分抽出を行う
- PR 説明やレビュー資料に貼りやすい Markdown サマリを出力する
- 必要なら compare 結果を review pack に取り込む

### Out Of Scope

- GitHub API への自動投稿
- pull request 自体の作成やマージ支援
- 変更の semantic correctness 判定を完全自動化すること

## Proposed UX

1. `CodeWalker: Build Review Pack` コマンドを追加する
2. 対象ソースは `git diff`, `targets.json`, または手動選択から決める
3. 各ファイルについて `existing walkthrough`, `stale walkthrough`, `missing walkthrough` を分類する
4. `.code-walker/review-packs/` に Markdown と JSON を出力する
5. 必要に応じて `compareWalkthroughs` の詳細リンクを pack から開けるようにする

## Technical Outline

- `listSymbolsTool` の path/targets ロジックを差分対象抽出へ流用する
- `compareWalkthroughs` の diff エンジンを review summary に再利用する
- export 形式は walkthrough 単体ではなく、複数ファイルのまとめレポートに拡張する
- 将来的には専用 prompt を追加できるが、初期実装はコマンド中心でよい

## Test Strategy

- changed file リストから対象だけが pack に含まれることを確認する unit テスト
- walkthrough が存在しない対象を `missing` として分類するテスト
- compare 結果がある場合に changed block 情報が Markdown に反映される integration テスト
- 出力された pack を再実行しても壊れないことを確認する回帰テスト

## Open Questions

- changed file 検出を Git 必須にするか、手動選択を常に許可するか
- review pack を `walks-auto` とは別保管にするか、同系統で管理するか
- review pack の出力先に HTML も含めるかどうか