# CodeWalker

Visual Studio Code と Copilot Agent Mode 向けの対話型コードウォークスルー拡張です。

CodeWalker は、コードを読んで理解した内容を再利用可能な walkthrough として残すためのツールです。意味的なブロック、CodeLens、行末注釈、詳細パネル、stale 検知、修復導線を VS Code 上に重ねて表示します。

## 機能

- 意味的ブロック - 関数、クラス、ファイル内の意味のまとまりをハイライト
- 手動 walkthrough - 選択範囲からブロック、解説、注釈を追加・編集・削除
- Agent 支援 walkthrough - Copilot Agent Mode から `code_walker_*` ツールを利用
- 永続キャッシュ - `.code-walker/walks-manual/` と `.code-walker/walks-auto/` に保存
- Sidebar Explorer - 登録済み、未登録、stale、batch target を Activity Bar から確認
- Stale Repair - CodeLens または Sidebar からずれたブロックを修復
- Graph / Timeline - シンボル関係と walkthrough 履歴を確認
- 多言語対応 - コマンド・設定の英日表示と、英日ドキュメント

## はじめかた

1. VS Code に CodeWalker をインストールして有効化します。
2. walkthrough を残したいワークスペースを開きます。
3. コード範囲を選択し、`CodeWalker: Add Block` で手動ブロックを作成します。
4. Activity Bar の CodeWalker ビューで登録済み、未登録、stale ファイルを確認します。
5. AI 支援が必要な場合は、Copilot Agent Mode から CodeWalker ツールを使います。

CodeWalker は walkthrough データをワークスペース内の `.code-walker/` に保存します。このフォルダを Git で共有するか ignore するかは、チームの運用に合わせて決めてください。

## 必要環境

- VS Code 1.99.0 以降
- AI 支援 walkthrough を使う場合は GitHub Copilot 拡張

## ドキュメント

- [User Guide (English)](https://github.com/taogya/CodeWalker/blob/main/docs/user-guide.md)
- [ユーザーガイド（日本語）](https://github.com/taogya/CodeWalker/blob/main/docs/user-guide.ja.md)
- [README (English)](README.md)
- [設計ドキュメント](https://github.com/taogya/CodeWalker/blob/main/docs/design/docs/README.md)
- [実装状況](https://github.com/taogya/CodeWalker/blob/main/docs/design/docs/99-status.md)

## プライバシーとセキュリティ

- walkthrough キャッシュはワークスペース内の `.code-walker/` にローカル保存されます。
- AI 支援の要約は、ユーザーが Copilot Agent Mode で CodeWalker ツールを使ったときに Copilot 側で生成されます。
- VSIX パッケージには、テストソース、ローカル実行時出力、`.github`、`.vscode`、`docs`、sourcemap、生成済みテスト出力を含めません。

## 開発

```bash
npm install
npm run compile
```

ローカルで VSIX を作成する場合:

```bash
npx @vscode/vsce package
```

## ライセンス

[BSD-3-Clause](LICENSE)