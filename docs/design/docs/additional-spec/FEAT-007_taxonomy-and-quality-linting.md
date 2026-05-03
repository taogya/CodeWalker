# FEAT-007: Taxonomy And Quality Linting

- 優先度: 高

## Problem

CodeWalker をチームで使うと、ラベル名の粒度、解説の密度、注釈の長さ、Manual 化の方針が人によってぶれます。現在は walkthrough の品質を揃える仕組みがなく、共有資産としての読みやすさが徐々に崩れやすいです。

## User Value

- チーム内で walkthrough の見た目と粒度を揃えやすくなる
- 説明不足や stale 放置を早めに見つけられる
- UI 追加を待たずに、資産の品質を上げられる

## Scope

- ラベル辞書、推奨ブロック粒度、注釈長、説明必須条件などのルールを定義できるようにする
- walkthrough を lint して警告一覧を出すコマンドを追加する
- 必要なら Sidebar や Dashboard に lint 結果を表示できるようにする
- Manual / Auto ごとに異なる quality policy を設定できる余地を持たせる

### Out Of Scope

- 自動修正の完全自動化
- 文章品質の完全評価
- VS Code 以外の外部 CI 連携の初期実装

## Proposed UX

1. `CodeWalker: Validate Walkthrough Quality` コマンドを追加する
2. 結果は problems ライクな一覧、または将来の Sidebar に表示する
3. 代表ルールとして `説明なし`, `注釈が長すぎる`, `ブロックが多すぎる`, `ラベルが辞書外`, `stale 放置` を検出する
4. チーム共通辞書は `.code-walker/config.json` または設定で持てるようにする

## Technical Outline

- 既存の `.code-walker` キャッシュと `BlockStore` から walkthrough データを収集する lint サービスを新設する
- `templateLabels` や将来の共有辞書と連携し、ラベル標準化の土台にする
- エディタ装飾、Sidebar、review pack への警告連携ができるように結果フォーマットを共通化する
- FEAT-002 Dashboard や FEAT-004 Sidebar への統合も見据えた設計にする

## Test Strategy

- ルールごとの違反検出 unit テスト
- キャッシュだけ存在するケースでも lint できるテスト
- コマンド実行から警告一覧表示までの integration テスト
- 辞書変更時に結果が正しく再計算される回帰テスト

## Open Questions

- 共有辞書を settings に置くか `.code-walker` に置くか
- Auto 生成物にはどこまで lint を強制するか
- Problems パネル連携と独自 UI のどちらを主にするか