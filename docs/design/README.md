# CodeWalker

VS Code 上でコードを意味的なブロックに分け、色分け、行末注釈、解説、修復導線を重ねて読み進めるためのコードウォークスルー拡張です。手動で作った walkthrough と Copilot Agent Mode で生成した walkthrough を分けて保存し、チーム共有や継続メンテナンスに使える状態を目指します。

## このリポジトリが解決すること

コードベースを読むときに、関数やクラスの中で「どこからどこまでが一つの意味のまとまりか」「なぜその処理があるのか」がエディタ上で見えにくい問題を扱います。CodeWalker は、ブロック単位のラベル、解説、注釈、stale 検知、横断ビューを VS Code 内に重ね、読解結果を `.code-walker/` に保存できるようにします。

## 想定ユーザー

- 既存コードを読み解き、理解した結果を残したい開発者
- 新規参加者向けにコードの読み筋を整備したいチーム
- Copilot Agent Mode の解析結果をそのまま捨てず、手動調整して再利用したい人
- リファクタ後も walkthrough 資産を保守したい人

## 何を提供するか

- エディタ上のブロックハイライト、CodeLens、行末注釈、Block Detail Webview
- 手動ブロック追加・編集・削除と、Auto 生成結果の Manual 取り込み
- `.code-walker/walks-manual/` と `.code-walker/walks-auto/` に分けた JSON キャッシュ
- Activity Bar の CodeWalker サイドバーによる Walkthrough Explorer / Uncovered Files / Stale Queue / Batch Targets
- stale block の repair 導線、定義行シフト、block hash 一致、曖昧候補 preview
- Symbol Graph と Timeline による横断・履歴ビュー
- Copilot Agent Mode から利用する `code_walker_*` ツールと `/codewalker` / `/codewalker-all` プロンプト

## 何をしないか

- コードの意味変化を完全に自動判断して walkthrough を安全修復すること
- Git merge、レビューコメント、課題管理を代替すること
- 任意言語の完全な call graph / dependency graph を保証すること
- Copilot Agent Mode なしで AI 要約を生成すること
- `.code-walker/` の共有方針やチーム運用ルールを自動で決めること

## 使い方の概観

1. 手動で範囲選択し、`CodeWalker: Add Block` からラベル、色、解説、注釈を保存する。
2. Copilot Agent Mode で `/codewalker` を使い、シンボル単位の Auto walkthrough を生成する。
3. 必要な Auto block は CodeLens から Manual に取り込み、編集して確定する。
4. Activity Bar の CodeWalker サイドバーで登録済み、未登録、stale、batch target を横断する。
5. stale が出た block は CodeLens または Sidebar から repair し、直せない場合は edit / import に戻す。
6. Graph / Timeline / Compare で walkthrough の関係や履歴を確認する。

詳細な UI と操作は [docs/03-ui.md](./docs/03-ui.md)、キャッシュ仕様は [docs/04-cache.md](./docs/04-cache.md)、設定は [docs/06-settings.md](./docs/06-settings.md) を参照してください。

## 前提環境

- VS Code 1.99+
- Node.js 18+（開発・ビルド時）
- GitHub Copilot 拡張（AI 要約機能を使う場合）

## 最短手順

開発中の拡張として動かす最短手順です。

```bash
npm install
npm run compile
```

その後 VS Code でこのリポジトリを開き、F5 で Extension Development Host を起動します。

VSIX として確認する場合は次を使います。

```bash
npx @vscode/vsce package
code --install-extension code-walker-*.vsix
```

検証コマンドは次の通りです。

```bash
npm run compile
npm test
```

## リポジトリ構成

| パス | 役割 |
|---|---|
| `src/extension.ts` | DI、コマンド、ツール、Sidebar、ライフサイクル登録 |
| `src/commands/` | Command Palette、CodeLens、Sidebar 起点の操作 |
| `src/tools/` | Copilot Agent Mode から呼ばれる `code_walker_*` ツール |
| `src/walker/` | BlockStore、CodeLens、ハイライト、Webview パネル |
| `src/sidebar/` | Sidebar snapshot、TreeDataProvider、階層表示、Sidebar 操作 |
| `src/cache/` | `.code-walker/` の型、I/O、復元、snapshot 読み取り |
| `src/test/` | unit / integration test と fixture |
| `docs/` | 設計、UI、cache、settings、usecase、status、将来仕様 |
| `media/` | Webview CSS / JavaScript / アイコン |
| `sample_project/` | プロンプト・動作確認用サンプル |

## 既知の制約

- Agent E2E と一部 Webview / QuickPick UX は自動テストではなく手動確認で扱います。
- C2 の destructive edit（ブロック全行削除、ブロック跨ぎ削除、跨ぎカット&ペースト）は保存時検証で警告し、自動削除はしません。
- Symbol Drift Repair は初期実装です。定義行シフト、一意 hash 再配置、曖昧 hash preview はありますが、delete / keep stale / nearby-search / repair metadata 永続化は今後の課題です。
- Symbol Graph は import / reference を best effort で可視化します。完全な静的解析を保証するものではありません。

## 関連ドキュメント

設計と運用情報は [docs/README.md](./docs/README.md) に集約しています。

- [docs/01-overview.md](./docs/01-overview.md) — アーキテクチャ、登録コマンド、主要フロー
- [docs/03-ui.md](./docs/03-ui.md) — CodeLens、Sidebar、Webview、Graph / Timeline
- [docs/04-cache.md](./docs/04-cache.md) — `.code-walker/` 構造、JSON、stale repair
- [docs/06-settings.md](./docs/06-settings.md) — VS Code Settings の全項目
- [docs/07-usecases.md](./docs/07-usecases.md) — 自動テストと手動確認済みフロー
- [docs/99-status.md](./docs/99-status.md) — 実装状況、保留事項、テスト結果
- [docs/additional-spec/README.md](./docs/additional-spec/README.md) — 将来機能の提案仕様

## ロードマップ

- 現在: Sidebar、Graph、Timeline、notification auto-dismiss、Block Detail navigation sync、Symbol Drift Repair 初期実装まで完了。
- 次候補: FEAT-001 の次スライス（repair decision、nearby-search、metadata）、FEAT-002 Coverage Dashboard、FEAT-007 Taxonomy / Quality linting。
- 保留: C2 destructive edit の自動クリーンアップは非破壊方針と衝突するため、現時点では警告表示に留めています。

詳細な進捗は [docs/99-status.md](./docs/99-status.md)、将来仕様は [docs/additional-spec/README.md](./docs/additional-spec/README.md) を正とします。

## ライセンス

本ソフトウェアは BSD-3-Clause で配布します。詳細は [LICENSE](../../LICENSE) を参照してください。
