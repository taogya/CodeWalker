# FEAT-008: Notification Auto Dismiss

- 優先度: 中
- 状態: 実装済

## Current Slice

- `codeWalker.notificationTimeoutSeconds` 設定を追加済み
- `src/utils/notifications.ts` の共通 utility から info / warning / error の timed notification を表示する
- `0` 指定時は VS Code 標準 message API へ fallback する
- unit test で fallback と timed notification の分岐を検証済み

## Problem

CodeWalker は保存、削除、キャッシュ復元警告、比較失敗などで VS Code の右下通知を多用します。現状は非対話通知も残り続けるため、連続操作時に通知が積み上がり、エディタやサイドバーの作業を邪魔しやすいです。

## User Value

- 保存や削除の完了通知を確認したら自然に消える
- stale 警告や比較失敗の情報を見落とさず、画面占有だけを減らせる
- CodeWalker の操作を続けても通知が溜まりにくい

## Scope

- action ボタンを持たない CodeWalker 通知を自動 dismiss 対象にする
- 秒数を VS Code 設定で変更できるようにする
- `0` を指定した場合は従来どおり残し続ける fallback を残す
- コマンド、Sidebar、restore、比較処理など複数箇所で共通 utility を利用する

### Out Of Scope

- 確認ダイアログや action 付き通知の自動 dismiss
- VS Code 標準通知以外の独自トースト UI 導入
- `.code-walker` キャッシュ構造の変更

## Proposed UX

1. `codeWalker.notificationTimeoutSeconds` を追加する
2. デフォルトは 3 秒にし、保存や削除などの完了通知は数秒で自動的に閉じる
3. blockHash mismatch や compare 失敗などの非対話 warning / error も同じ秒数で閉じる
4. ユーザーが `0` を設定した場合だけ、従来の通知 API に戻して通知を残す

## Technical Outline

- `src/utils/notifications.ts` に severity 付き共通通知 utility を追加する
- 通知秒数は `vscode.workspace.getConfiguration('codeWalker')` から取得する
- `withProgress({ location: Notification })` を使って時間経過で閉じる実装に寄せる
- `clearCacheCommand`、`deleteBlockCommand`、`restoreFromCache`、`compareWalkthroughsCommand`、Sidebar コマンドなど既存 call site を段階的に置き換える
- `.code-walker` のデータ構造、`BlockStore`、`CacheService`、既存 `codewalker` / `codewalker-all` プロンプト契約は変更しない

## Test Strategy

- `notificationTimeoutSeconds=0` で通常の `showInformationMessage` fallback が使われる unit テスト
- `notificationTimeoutSeconds>0` で timed notification 経路に入る unit テスト
- 代表コマンド実行後も compile / integration test が既存挙動を壊していないことを確認する

## Open Questions

- warning / error を info と同じ秒数で閉じるべきか、別設定に分けるべきか
- 通知が短すぎると見逃すケースがあるため、デフォルト秒数を 3 に固定して十分か
- 将来 Webview ベースの独自トーストを導入する場合、この utility をどこまで抽象化するか