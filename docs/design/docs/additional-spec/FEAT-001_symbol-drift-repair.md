# FEAT-001: Symbol Drift Repair

- 優先度: 高
- 状態: 初期実装

## Problem

CodeWalker は `blockHash` によって stale なブロックを検出できますが、現在は `⚠` を付けるだけです。コード変更後に Manual 資産を維持したい場合でも、再解析か手修正に頼る必要があり、運用コストが高いです。

## User Value

- リファクタ後も既存の解説・注釈・ブロック構造を活かしやすくなる
- `walks-manual/` をチーム共有しやすくなる
- `⚠` が単なる警告ではなく、修復アクションの入口になる

## Scope

- stale 判定されたシンボルに対する repair フローを追加する
- 既存ブロックの再マッピング候補を提示する
- 解説と注釈を保持したまま、新しい行範囲へ移し替えられるようにする
- Manual と Auto の両方を対象にでき、修復後は元の保存先（manual / auto）へ書き戻す。表示は ViewMode に従い、Both では同一シンボル内の Manual / Auto が共存できる

### Out Of Scope

- Git merge の自動解決
- 関数の完全な意味変化を伴う大規模リライトへの完全自動追従
- 既存 `codewalker` / `codewalker-all` プロンプトの全面再設計

## Proposed UX

1. `⚠` 付き CodeLens またはコマンドパレットから `CodeWalker: Repair Walkthrough` を起動する
2. パネルに「現在のコード」「旧ブロック」「候補の新行範囲」を並べて表示する
3. ユーザーはブロック単位で「採用」「手修正」「削除」を選べる
4. 保存時に `walks-manual/` または `walks-auto/` を更新し、ハイライトを再描画する

### Preview UI Draft

- 自動修復で安全性を証明できない場合、または複数候補が競合する場合に preview パネルを開く
- パネルは 3 カラム構成を想定する
	- 左: current symbol のコードと候補範囲ハイライト
	- 中央: stale block ごとの候補カード（旧範囲、候補範囲、理由、confidence）
	- 右: 採用 / 手修正 / 削除 / 保留 のアクション
- 候補カードには最低限次の情報を出す
	- strategy: `definition-shift` / `block-hash-match` / `nearby-search`
	- old range と candidate range
	- explanation / annotations が保持されるか
	- 一致根拠（hash 一致、定義行 delta、近傍一致など）
- 一括操作として `Apply safe candidates`, `Open selected block in editor`, `Cancel` を持たせる

### Preview Session Rules

- preview を開いただけでは `.code-walker` の cache を更新しない
- 保存時に選ばれた decision だけを同じ保存先（manual / auto）へ書き戻す
- `delete` を選んだ block だけを entry から除去し、他 block は保持する
- `keep stale` は保存対象から外し、現状の cache を変更しない

## Current Slice

- Sidebar `Repair Walkthrough`、CodeLens `[🛠]`、コマンドパレット `CodeWalker: Repair Walkthrough` から修復を起動できる
- 初期実装では「シンボル定義行が前後にずれた」ケースを対象に、block 群と annotations を同じ delta で一括シフトする
- 定義行が変わらないケースでも、current symbol 内で target block の `blockHash` が一意一致すれば、説明と annotations を保持したまま block 単位で再配置する
- 対象 block の `blockHash` が新しい行範囲で一致した場合だけ自動修復し、成立しないケースは既存の edit/import パネルへフォールバックする
- 複数 `blockHash` 一致で自動適用できないケースは Repair Preview に送り、候補選択または edit/import 継続を選べる
- Repair Preview の現行対象は `block-hash-match` の曖昧候補が中心で、`definition-shift` の review-only 候補提示は限定的
- repair metadata の永続化、delete / keep stale / apply safe candidates、nearby-search 候補生成はまだ未実装

## Next Slice

- 次段では preview 上で `delete` / `keep stale` / `Apply safe candidates` を扱える decision model を追加する
- `definition-shift` と `block-hash-match` の preview 候補生成を整理し、safe candidate と review-only candidate の判定を UI とテストで明確化する
- `nearby-search` は read-only 候補提示から始め、採用時は既存の `restoreFromCache` フローで再描画できる形式に正規化して保存する

## Technical Outline

- `restoreCache` と `computeBlockHash` の既存判定を repair 起点に再利用する
- 近傍行比較、ラベル一致、注釈行の近接度などを用いて行範囲候補を作る
- 必要に応じて AI 補助を使うが、最終決定はユーザー操作にする
- `BlockStore` と `highlighter` に repair 用の一時状態を追加する
- 将来的に `code_walker_export` に repair metadata を加えられる余地を残す
- preview 用に `RepairCandidate`, `RepairDecision`, `RepairSessionState` 相当の中間モデルを追加し、cache 反映前の候補を保持できるようにする
- current slice の自動修復ロジックは preview 候補生成の第一段として再利用し、duplicate 実装を避ける
- preview パネルは `blockEditPanel` とは分離しつつ、editor reveal と syntax highlight の共通 helper は流用する

## Test Strategy

- 行の前後移動だけが起きたケースで自動再マッピングできる integration テスト
- 1 ブロックだけ消えたケースで削除候補になることを確認するテスト
- 修復後に explanation / annotations / source が保持されることを確認するテスト
- repair をキャンセルした場合に既存キャッシュが壊れないことを確認するテスト
- 複数候補が見つかった場合に preview が開き、自動適用されないことを確認するテスト
- preview で block 単位に `採用 / 手修正 / 削除 / 保留` を混在させても、選択した decision だけが保存されることを確認するテスト
- preview 上で `Apply safe candidates` を選んだ場合に current slice の安全な候補だけ一括反映されることを確認するテスト

## Open Questions

- repair 候補生成を AI 補助なしでどこまで実用にできるか
- Auto キャッシュの repair をユーザー保存なしで許可するか
- repair metadata を `.code-walker` に永続化するかどうか
- 自動適用可能な 1 件候補でも、preview を挟むモードを設定で提供するかどうか