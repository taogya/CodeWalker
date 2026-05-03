# FEAT-006: Walkthrough Timeline View

- 優先度: 中
- 状態: 初期実装

## Problem

`compareWalkthroughs` は 2 点比較には便利ですが、walkthrough がどのように育ってきたかを時系列で追う体験はありません。バックアップ運用や継続メンテナンスをしているチームでは、差分の積み重なりを視覚的に確認できる UI があると理解とレビューが楽になります。

## User Value

- walkthrough の進化を時系列で追える
- いつ stale が増えたか、いつ Manual 化が進んだかを把握できる
- compare 結果を単発ではなく履歴として読める

## Scope

- walkthrough スナップショットの一覧と時系列比較 UI を追加する
- あるファイルまたはシンボルについて、各時点のブロック数、source、stale 状態を表示する
- バックアップフォルダや review pack と接続できるようにする

### Out Of Scope

- Git commit 履歴の完全な代替
- バイナリ保存や外部ストレージ同期
- 自動バックアップ戦略のすべてを内包すること

## Proposed UX

1. `CodeWalker: Open Timeline` コマンドで Webview を開く
2. 左にシンボル一覧、上に時系列バー、中央に比較結果カードを並べる
3. シンボル選択時に各スナップショットの `Manual/Auto`, `block count`, `stale`, `updatedAt` を並べる
4. 任意の 2 点を選ぶと、既存 compare と同様の差分詳細へ遷移できる
5. 変更量が大きい時点は色で強調する

## Technical Outline

- 現在の `compareWalkthroughs` を N 点比較へ拡張できる形で差分エンジンを整理する
- スナップショットのメタ情報を `.code-walker` 配下か別 manifest に保持する
- バックアップフォルダ命名規則がある場合は自動認識し、無い場合は手動登録を許可する
- FEAT-003 review pack や既存バックアップ運用と自然に接続できるようにする

## Current Slice

- `CodeWalker: Open Timeline` コマンドで Webview を開ける
- current `.code-walker` と任意 snapshot root を Timeline データへ正規化する
- snapshot ごとの `source`, `blockCount`, `stale`, `updatedAt`, `changeMagnitude` を表示する
- 左の symbol list から対象を選び、最新 snapshot の open / detail に遷移できる
- 任意の 2 snapshot を選んで既存 compare パネルを開ける

## Next Slice

- snapshot manifest を導入するか、現行のフォルダ選択方式を維持するかを決める
- changeMagnitude の定義を block 数・source・stale だけで十分か、ラベル / explanation 差分も含めるか検討する
- FEAT-003 review pack と接続し、レビュー用 snapshot セットを開けるようにする

## Test Strategy

- 複数スナップショットから正しい時系列ソートができる unit テスト
- 同一シンボルの source、block 数、stale 状態が UI 用データに正しく変換されるテスト
- 2 点選択から比較詳細を開ける integration テスト
- スナップショット欠損時の graceful degradation を確認するテスト

## Open Questions

- スナップショット manifest を自動生成するか、既存バックアップだけから推測するか
- Timeline を compare パネルの拡張にするか、独立ビューにするか
- updatedAt と実ファイル変更時刻のどちらを主軸にするか