# FEAT-004: Walkthrough Explorer Sidebar

- 優先度: 高
- 状態: 初期実装

## Problem

現在の CodeWalker はエディタ上の CodeLens やコマンド起点の操作には強い一方で、ワークスペース全体を横断して「どこにどの walkthrough があるか」を一覧する常設 UI がありません。特に stale、Manual、Auto、未整備を横断するときは、キャッシュファイルや個別ファイル移動に頼る必要があります。

## User Value

- 左タブから CodeWalker の状態を常時確認できる
- ファイル、シンボル、ブロック単位で迷わず移動できる
- stale や pending を起点に次の整備対象を選びやすくなる
- Manual と Auto の混在状況を UI で直感的に把握できる

## Scope

- Activity Bar に CodeWalker 専用ビューコンテナを追加する
- サイドバー内に TreeView または複数 View を追加する
- フォルダ、ファイル、シンボル、ブロックを階層表示する
- `Manual`, `Auto`, `⚠ stale`, `pending`, `done`, `skip` をバッジやアイコンで表示する
- その場からファイルを開く、ブロック詳細を開く、再解析を起動する導線を用意する

### Out Of Scope

- GitHub や PR との直接連携
- 複数ワークスペースの統合表示
- ブロック編集 UI 自体をサイドバー内に完全移植すること

## Proposed UX

1. Activity Bar に CodeWalker アイコンを追加する
2. サイドバーに次の 3 View を置く
3. Walkthrough Explorer: ツリー形式で Workspace → File → Symbol → Block を表示する
4. Stale Queue: `⚠` のあるシンボルだけを抽出する
5. Batch Targets: `targets.json` の pending、done、skip を表示する
6. 各ノードのコンテキストメニューから open、show detail、export、repair、clear cache を呼べるようにする

## Technical Outline

- `package.json` の viewsContainers と views を使って左タブを追加する
- データソースは `CacheService`、`restoreCache` の stale 判定結果、`targets.json` を統合する専用サービスを新設する
- 可視状態の同期には `BlockStore.onDidChange` とファイルシステム再読込を併用する
- 一部は TreeDataProvider、詳細ペインは WebviewView で分担できる構成にする
- 将来的な FEAT-001 repair や FEAT-002 coverage 集計の起点 UI にもできるようにする

## Current Slice

- Activity Bar に CodeWalker view container を追加済み
- Walkthrough Explorer / Uncovered Files / Stale Queue / Batch Targets の 4 view を実装済み
- file / target はフォルダ階層を挟んで表示できる
- Manual / Auto / Mixed / stale の description と icon を表示できる
- Sidebar ノードから open、show detail、Markdown export、repair、clear cache を実行できる
- Manual / Auto が同一シンボルに混在する場合も `[M]` / `[A]` 付き block として両方表示する

## Next Slice

- 混在シンボル配下に Manual / Auto の source section node を挟むか、現行の flat `[M]` / `[A]` 表示を維持するかを UX 確認する
- FEAT-002 Coverage Dashboard と責務分担し、Sidebar は日常導線、Dashboard は集計導線に寄せる
- 大規模リポジトリでの再読込頻度、snapshot cache、手動 refresh の境界を詰める

## Test Strategy

- キャッシュと targets 情報から正しいツリー階層が生成される unit テスト
- stale のあるシンボルだけが Stale Queue に出るテスト
- ノード選択からファイルオープンや detail 表示が正しく発火する integration テスト
- Manual / Auto / pending のバッジが正しく切り替わるテスト

## Open Questions

- Explorer と Stale Queue を 1 View に統合するか分離するか
- TreeView だけで十分か、右側に常設プレビュー WebviewView を持たせるか
- 大規模リポジトリでの再読込頻度とパフォーマンスをどう制御するか