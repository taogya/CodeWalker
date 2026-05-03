# CodeWalker ユーザーガイド

## 基本概念

- ブロック: ラベル、色、説明、注釈を持つ意味的なコード範囲です。
- Walkthrough: シンボルまたはファイルに対するブロックと解説のまとまりです。
- Manual source: ユーザーが作成、確認、編集したブロックです。
- Auto source: Copilot Agent Mode と CodeWalker ツールで生成したブロックです。
- Stale block: 保存済みの範囲や hash が現在のソースと合わなくなったブロックです。

## 手動 walkthrough を作る

1. VS Code でソースファイルを開きます。
2. 解説したいコード範囲を選択します。
3. Command Palette または editor context menu から `CodeWalker: Add Block` を実行します。
4. ラベル、色、説明、注釈を指定します。
5. 生成された CodeLens から詳細表示、編集、削除を行います。

手動 walkthrough は `.code-walker/walks-manual/` に保存されます。

## Agent 支援 walkthrough を作る

1. Copilot Chat を Agent Mode で開きます。
2. CodeWalker ツールを使って関数、クラス、ファイルを解析するよう agent に依頼します。
3. agent は `code_walker_analyze`、`code_walker_highlight`、必要に応じて `code_walker_export` を呼び出します。
4. エディタ上に生成されたブロックを確認します。
5. 残したい Auto block は Manual block として取り込み、必要に応じて編集します。

Auto walkthrough は `.code-walker/walks-auto/` に保存されます。

## Sidebar を使う

Activity Bar の CodeWalker ビューから、次の一覧を使えます。

- Walkthrough Explorer: `.code-walker/` に登録済みのファイル、シンボル、ブロック
- Uncovered Files: CodeWalker の scan 設定には一致するが walkthrough が未作成のファイル
- Stale Queue: ソース変更後に確認が必要なシンボルとブロック
- Batch Targets: `.code-walker/targets.json` の pending、done、skip

Sidebar の context menu から、ファイルを開く、ブロック詳細を表示する、Markdown を export する、cache を clear する、repair を開始する、といった操作ができます。

## Stale block を修復する

CodeWalker が stale block を検出すると、Block Detail と CodeLens に警告が表示されます。

修復には次の入口を使えます。

- stale block の repair CodeLens をクリックする
- active editor で `CodeWalker: Repair Walkthrough` を実行する
- Sidebar の Stale Queue から repair action を実行する

CodeWalker は、定義行のずれや一意な block hash 一致を自動修復できます。候補が曖昧な場合は preview を表示し、ユーザーが選んで適用します。安全な候補がない場合は、手動編集または import に進みます。

## 設定する

VS Code Settings の `CodeWalker` から設定できます。

- `codeWalker.enableDebugLog`
- `codeWalker.enableLineTracking`
- `codeWalker.notificationTimeoutSeconds`
- `codeWalker.templateLabels`
- `codeWalker.defaultColor`
- `codeWalker.annotationStyle`
- `codeWalker.viewMode`
- `codeWalker.skipPatterns`
- `codeWalker.extensions`

詳細は [設定リファレンス](design/docs/06-settings.md) を参照してください。

## Cache files

CodeWalker は現在のワークスペース内の `.code-walker/` に walkthrough cache を保存します。

- `.code-walker/walks-manual/`: ユーザーが確認した walkthrough
- `.code-walker/walks-auto/`: Agent が生成した walkthrough
- `.code-walker/targets.json`: batch walkthrough の対象リスト

`.code-walker/` は、チームで walkthrough を共有したい場合だけ commit してください。

## トラブルシュート

- ハイライトが消えた場合は、対象ファイルを開き直してください。
- ソース編集後にブロックがずれて見える場合は、ファイルを保存して stale 検証を走らせてください。
- 通知が長く残る場合は、`codeWalker.notificationTimeoutSeconds` を調整してください。
- scan 結果にファイルが出ない場合は、`codeWalker.extensions` と `codeWalker.skipPatterns` を確認してください。

## 関連ドキュメント

- [設計ドキュメント](design/docs/README.md)
- [実装状況](design/docs/99-status.md)
- [English User Guide](user-guide.md)