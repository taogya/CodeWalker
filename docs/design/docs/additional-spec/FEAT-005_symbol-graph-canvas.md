# FEAT-005: Symbol Graph Canvas

- 優先度: 中
- 状態: 初期実装

## Problem

現在の walkthrough は各ファイルやシンボルを縦に理解する体験には向いていますが、「このシンボルがどこへ依存し、どのブロックがどこでつながっているか」を面で把握する UI がありません。コードベース全体の構造理解では、テキスト中心の遷移だけでは限界があります。

## User Value

- 依存関係や責務分割をグラフとして見られる
- walkthrough の存在有無や stale 状態をノード色で可視化できる
- オンボーディングや設計レビューで全体像を説明しやすくなる

## Scope

- シンボル、ファイル、必要に応じてブロックをノード化するグラフ UI を追加する
- import、参照、親子シンボル関係、walkthrough の有無を可視化する
- ノード選択からエディタ移動、block detail 表示、walkthrough 開始を行えるようにする
- フィルタで `stale only`, `manual only`, `selected folder only` を切り替えられるようにする

### Out Of Scope

- 完全な call graph 解析の保証
- 実行時プロファイルの可視化
- リアルタイム共同編集

## Proposed UX

1. `CodeWalker: Open Symbol Graph` コマンドで Webview キャンバスを開く
2. ノードの色で `Manual`, `Auto`, `No walkthrough`, `Stale` を表す
3. エッジの種類で `contains`, `imports`, `references` を見分けられるようにする
4. ノードクリックで概要、最後の更新時刻、ブロック数をサイドパネルに出す
5. 範囲選択や検索で対象を絞り込めるようにする

## Technical Outline

- `listSymbolsTool` の出力と LSP ベースの参照情報を統合するグラフ生成サービスを用意する
- 表示は Webview 上の SVG もしくは canvas ベースで実装する
- walkthrough 状態は `.code-walker` キャッシュから集計し、`compareWalkthroughs` の差分情報とも連携できる余地を持たせる
- ノードの詳細パネルは既存の block detail 表示と責務を分け、概要中心にする

## Current Slice

- `CodeWalker: Open Symbol Graph` コマンドで Webview を開ける
- walkthrough cache、targets、import、reference を統合した `file` / `symbol` / `block` ノードを生成する
- `contains` / `imports` / `references` edge を表示用データに正規化する
- search、folder prefix、stale only、manual only のフィルタを持つ
- ノードからファイル open と block detail 表示に遷移できる

## Next Slice

- UI レイアウトと大規模データ時の描画負荷を手動確認し、必要なら clustering / lazy expansion を入れる
- reference edge の精度を language server 依存に寄せるか、軽量 text scan のままにするかを決める
- FEAT-002 / FEAT-007 の集計結果を node status に重ねるか検討する

## Test Strategy

- 小さな fixture から期待したノード、エッジが生成される unit テスト
- キャッシュ状態に応じてノードのステータス色が変わるテスト
- ノード選択からファイルオープンや detail 表示が起動する integration テスト
- フィルタ条件の組み合わせで表示対象が安定する回帰テスト

## Open Questions

- 参照情報をどこまで language server に依存するか
- ブロックを常にノード化するか、ズーム時だけ展開するか
- 大規模ワークスペースでのレイアウト計算負荷をどう抑えるか