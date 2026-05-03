# 99 — 実装状況・課題

[← 目次](./README.md)

> 最終更新: 2026-04-28

---

## 実装済み

### Phase 1-2: コアフロー + UI ✅

- シンボル解析 + 6 色ブロックハイライト
- CodeLens + Webview パネル（シンタックスハイライト 7 言語）
- 行末アノテーション（蓄積型マージ）
- 質問ループ（QuickPick テキスト入力 / ESC 終了）
- プロンプトファイル（codewalker / codewalker-all）

### Phase 3: 拡張機能 ✅

- JSON / Markdown エクスポート（フォーマット選択 UI）
- VS Code 再起動時キャッシュ復元
- クロスファイルシンボル検索
- バッチ処理（list_symbols + batchMode）
- codewalker-all プロンプトファイル

### Phase 3+: シンボル単位管理 ✅

- CodeLens シンボル単位管理 (`Map<uri, Map<symbolName, BlockDetail[]>>`)
- highlight symbolName パラメータ
- targets.json 出力・編集・fromFile 再読込
- restoreCache シンボル単位復元

### Phase 4 基盤: キャッシュ分離・ハッシュ・バッジ ✅

- キャッシュ分離: `walks-auto/` / `walks-manual/` ディレクトリミラー
- 共通型定義 (`cacheTypes.ts`): `CachedFileExport`, `CachedSymbolEntry`, `CachedBlock`, `CacheSource`
- ブロック単位ハッシュ検知 (`computeBlockHash` SHA-256) + 復元時 ⚠ 通知（対象行のみをハッシュ化、無関係な編集で警告が出ない）
- 復元優先順位: `walks-manual/` → `walks-auto/`（シンボル単位で解決）
- CodeLens `[M]`/`[A]` ソースバッジ表示
- `CachedWalkthrough` に `source` フィールド追加
- Clear Cache コマンド（ファイル単位 / Auto全 / Manual全 / 全キャッシュ）
- レガシーキャッシュコード完全削除（`toFileStem`, 3-tier fallback 等）

### Phase 4 UI: マニュアルモード ✅

- **4.2** 右クリック「Add Block (Manual)」コマンド + ブロック編集 Webview (`blockEditPanel.ts`)
  - ラベル入力（テンプレート候補チップ付き）
  - 行範囲（startLine / endLine）
  - 6 色パレット選択
  - 概要・解説(Markdown)・行末アノテーション入力
  - 保存 → `walks-manual/` に JSON 書込 + ハイライト/CodeLens 即時更新
- **4.3b** CodeLens 操作ボタン
  - Manual ブロック: `[📝]` 編集 / `[✕]` 削除
  - Auto ブロック: `[📥]` Auto→Manual インポート
- **4.4** Auto→Manual インポート: Auto ブロックの `[📥]` で Edit Webview を開き Manual として保存
- **4.6** 色選択: 編集 Webview 内 6 色パレット（青/緑/紫/オレンジ/赤/シアン）
- **4.7** config.json テンプレート (`configReader.ts`): labels / defaultColor / annotationStyle
- **4.8** プレビューボタン: Webview 内「👁 プレビュー」でエディタ上にハイライト仮表示
- **Clear Cache シンボル単位削除**: 5 択 QuickPick（現在のシンボル選択削除を追加）
- **CodeLens ⚠ マーク**: ハッシュ不一致時に `⚠` バッジを CodeLens タイトルに表示
- **ブロック削除**: 確認ダイアログ→キャッシュJSON + CodeLens 両方から削除

### Phase 5: アーキテクチャリファクタリング ✅

- **A-1** extension.ts 451→136 行: 7 コマンドハンドラを `src/commands/` に抽出
- **A-2** CacheService 新設 (122行): 6 箇所のキャッシュ I/O 重複を統合
- **A-3** BlockStore 新設 (155行): CodeLensProvider 224→92 行（表示専門化）
- **A-4** 循環参照解消: コンストラクタ DI で `highlightTool → extension` の逆参照を排除
- 全ツール・コマンド・復元処理が CacheService / BlockStore 経由に統一
- ビルドパス確認済み (`npm run compile` エラー 0 件)

### Phase 5+: L2 Webview + esbuild パスエイリアス ✅

- **L2 Webview 外部化**: `blockDetailPanel.ts` / `blockEditPanel.ts` のインライン CSS/JS を `media/` に分離
  - `shared.css` (98行), `blockEdit.css` (118行), `blockDetail.css` (126行), `syntax.css` (24行), `blockEdit.js` (117行)
  - TypeScript 合計: 4,214→3,986 行 (-228)
- **esbuild 導入**: `tsc` 単体 → `tsc --noEmit` (型チェック) + `esbuild` (バンドル) に移行
  - 出力: 個別 `.js` 群 → 単一 `out/extension.js` (95KB) にバンドル
  - `.vsix` サイズ削減 + 起動速度向上
- **パスエイリアス**: `tsconfig.json` の `paths` + esbuild `alias` で `@walker/*`, `@cache/*`, `@utils/*`, `@analysis/*`, `@tools/*`, `@commands` を定義
  - 全 cross-directory import を `'../walker/blockStore'` → `'@walker/blockStore'` 形式に統一
  - `../` 相対パス: 0 件（同一ディレクトリ内の `./` のみ残存）
  - ディレクトリ構造変更時の import 崩壊リスクを排除
- **ダイアグラム更新**: c4-component.dsl, c4-container.dsl, architecture.mmd を Phase 5 アーキテクチャに合わせて更新 + 8 SVG 再レンダリング

### Phase 6: バグ修正 + UX 改善 ✅

- **#1 ハイライト消失バグ修正**: `onDidCloseTextDocument` リスナー追加。ファイルクローズ時に `restoredUris` / highlighter / BlockStore からデータを除去し、再オープン時にキャッシュから正しく復元されるように修正
- **#2 プレビュー残留ハイライト修正**: `blockEditPanel` の `onDidDispose` で `clearSymbol(editor, '__preview__')` を呼び、パネルを閉じた際にプレビュー用装飾を除去
- **#3 生 URL 自動リンク化**: `blockDetailPanel` の `inlineFormat()` に生 URL 検出正規表現を追加（負の後読みで二重マッチ回避）
- **#4 画像リンク対応**: Markdown 画像リンクを `<img>` タグへ変換する処理を `inlineFormat()` に追加（リンク変換より先に処理）
- **#5 ソースコード折りたたみ**: 解説パネルのソースコードセクションを `<details>/<summary>` で折りたたみ対応 + CSS スタイリング追加
- **#6 ViewMode 切替**: グローバル表示モード（Both / Manual Only / Auto Only）を実装
  - `BlockStore` に `ViewMode` 型 + `viewMode` プロパティ追加
  - `setViewMode` コマンド（QuickPick UI + ステータスバー表示）
  - CodeLens の `source` フィルタリング
  - モード切替時のハイライト再描画（`reapplyHighlightsForViewMode`）

### Phase 7: 機能追加 + 設定 + バグ修正 ✅

- **#8 バッチ中断・再開**: `ExportTool` の batchMode 成功時に `markTargetDone()` で `targets.json` のステータスを `done` に自動更新。中断後 `fromFile` で再読込すると pending のみが返り、完了分をスキップして再開可能に
- **#9 Webview ナビゲーション**: 解説パネル（blockDetailPanel）にブロック間ナビゲーション UI を追加
  - ナビバー: 前後ボタン + ブロック一覧ドロップダウン（`<select>`）
  - `navigateBlock` メッセージ → `showBlockDetailCommand` 再実行でパネル内容を差し替え
  - `openFile` メッセージ → 解説文中のファイルパス参照をクリッカブルリンク化（Webview→エディタ連携）
  - `media/blockDetail.js` 新設、`media/blockDetail.css` にナビバースタイル追加
- **#10 設定画面（VS Code Settings 統合）**: ハードコード設定値を `contributes.configuration` に移行
  - `codeWalker.templateLabels`: Add Block テンプレートラベル候補（配列）
  - `codeWalker.defaultColor`: デフォルトブロック色インデックス（0-5）
  - `codeWalker.annotationStyle`: アノテーションのフォントスタイル（`italic` / `normal`）
  - `codeWalker.viewMode`: 起動時の ViewMode デフォルト（`both` / `manual-only` / `auto-only`）
  - `codeWalker.skipPatterns`: ファイルスキャン除外パターン（正規表現配列）
  - `codeWalker.extensions`: スキャン対象ファイル拡張子（配列）
  - `codeWalker.enableDebugLog`: デバッグログ ON/OFF
  - `codeWalker.enableLineTracking`: 行番号自動追従 ON/OFF（デフォルト ON）
  - `configReader.ts` を `vscode.workspace.getConfiguration('codeWalker')` ベースに全面書き換え
  - `extension.ts` で起動時に設定から viewMode を読み込み `BlockStore` に反映
- **CodeLens 非表示バグ修正**: `highlightTool` で `blockStore.setBlocks()` に `source` 引数が渡されていなかったため、`source: undefined` のブロックが ViewMode フィルタ（`manual-only` / `auto-only`）で除外されていた。`'auto'` を明示的に渡すよう修正

### Phase 8: i18n + ウォークスルー比較 ✅

- **#13 多言語対応 (i18n)**: `@vscode/l10n` ライブラリを導入し全 UI 文字列を英語デフォルト化
  - `l10n/bundle.l10n.ja.json`: 100+ キーの日本語翻訳バンドル
  - `package.nls.json` / `package.nls.ja.json`: package.json 文字列の NLS 外部化
  - 13 ソースファイルを `l10n.t()` 呼び出しに移行（コマンド / ツール / Webview / CodeLens）
  - PALETTE 名・テンプレートラベルを英語デフォルトに変更
  - esbuild で `@vscode/l10n` をバンドル
- **#12 ウォークスルー比較**: コマンドパレットからキャッシュフォルダ間の差分比較を実行
  - `compareWalkthroughs` コマンド (`src/commands/compareWalkthroughs.ts`)
  - 対象 A: デフォルトは現在の `.code-walker/`（変更可）
  - 対象 B: ユーザーがフォルダ選択（必須）
  - `walks-manual/` + `walks-auto/` を再帰読込、同一シンボルの Manual / Auto を比較対象としてマージ
  - ファイル → シンボル → ブロック の 3 階層で差分算出
  - 差分結果を Webview パネルで表示（追加 🟢 / 削除 🔴 / 変更 🟡 アイコン付き）

### Phase 9: バグ修正 + テスト拡充 ✅

- **B1 修正**: `extension.ts` の `return` 文がキャッシュ復元ライフサイクルコードより前にありデッドコード化していた問題を修正
- **explanation 復元バグ修正**: `ExportTool` がキャッシュ JSON 保存時に `BlockStore` の explanation を含めていなかった問題を修正。コンストラクタ DI で `BlockStore` を注入し、`getExplanation()` フォールバックを追加
- **UC4.6 テスト追加** (3 ケース): explanation 往復保存の統合テスト
- **UC4.1 テスト修正**: キャッシュパス不整合・ハッシュプレフィックス不足・`restoreFromCache` 直接呼出しに変更
- **B8 修正**: `showBlockDetail` の「ブロック情報が見つかりません」メッセージにファイル名・シンボル名・ブロックインデックスを追加
- **B9 対応**: `codeWalker.enableDebugLog` 設定を追加。デフォルト OFF、設定変更時に動的切替
- **ブロック単位ハッシュ移行**: `fileHash`（ファイル全体）を廃止し `blockHash`（対象行 startLine〜endLine）に移行。ブロックと無関係な編集で⚠が出なくなり、変更されたブロックだけに⚠が付く
- **B3 対応**: `codewalker-all.prompt.md` に「レベル別ブロック分割ルール」セクションを追加。function=ロジックフロー分割 / class=メソッド単位分割 / file=セクション単位分割
- **B4 修正**: `AnalyzeTool` に `BlockStore` を注入し、analyze 開始時に stale な BlockStore データ + ハイライトをクリア。Export キャンセル時の CodeLens 残存は仕様として明確化
- **B10 対応**: プロンプトに「最初のブロックの startLine は定義行（def/function/class キーワード行）にする」ルールを追加
- **C2 実装**: 行番号自動追従機能。`onDidChangeTextDocument` でブロックの startLine/endLine を自動調整。`codeWalker.enableLineTracking` 設定で ON/OFF 可能
- **C2 テスト追加** (4 ケース): ブロック前・内・後の行挿入/削除での行番号調整検証
- **C2-F 実装**: 保存時ブロック整合性検証（`validateBlocks`）。0行ブロック・逆転ブロック・重複ブロックを検出し `hashMismatch=true` で ⚠ 表示。`onDidSaveTextDocument` で自動検証、ファイル概要（`📄`）は除外
- **C2-F テスト追加** (4 ケース): C2.5〜C2.8 — 正常ブロック/0行ブロック/逆転ブロック/重複ブロックの検証

### Phase 10: Sidebar Explorer ✅

- Activity Bar に CodeWalker ビューコンテナを追加
- `Walkthrough Explorer` で `walks-manual/` と `walks-auto/` を統合し、File → Symbol → Block の階層表示を実装
- `Stale Queue` で `blockHash` 不一致のシンボルだけを抽出表示
- `Batch Targets` で `.code-walker/targets.json` の pending / done / skip を status ごとに表示
- サイドバーからファイルオープン、ブロック詳細表示、targets.json オープン、手動 refresh の導線を追加
- `SidebarDataService` と TreeDataProvider を分離し、sidebar snapshot を integration test で検証可能にした

### Phase 10+: Sidebar Actions + Notification UX ✅

- `codeWalker.notificationTimeoutSeconds` 設定を追加し、保存・削除・比較失敗などの非対話通知を秒数指定で自動 dismiss できるようにした
- `0` 指定時は従来どおり `showInformationMessage` / `showWarningMessage` / `showErrorMessage` fallback を維持
- Sidebar ノードに Markdown export、stale repair 入口、file/symbol 単位 clear cache のコンテキストメニューを追加
- stale file/symbol/block から直接 edit/import パネルを開けるようにし、FEAT-001 repair の入口を用意した

### Phase 11: Graph + Timeline ✅

- `CodeWalker: Open Symbol Graph` コマンドを追加し、walkthrough / targets / import / reference を統合した Graph Webview を実装
- Graph では file / symbol / block ノード、`contains` / `imports` / `references` edge、search / folder prefix / stale / manual filter を提供
- `CodeWalker: Open Timeline` コマンドを追加し、current `.code-walker` と任意 snapshot root を横断する Timeline Webview を実装
- Timeline では snapshot ごとの `source`, `blockCount`, `stale`, `updatedAt`, `changeMagnitude` を時系列で表示し、任意の 2 点から既存 compare パネルを開ける

### Phase 11+: Block Detail Navigation Sync ✅

- Block Detail Webview の Prev / Next 操作時に、エディタ表示位置も対象ブロックへ追従するようにした
- `showBlockDetailCommand` に editor reveal オプションを追加し、通常の詳細表示とナビゲーション時の表示更新を分離した
- Webview からの navigateBlock callback は `preserveFocus` 付きで editor を reveal し、読み進め中も Webview 側のフォーカスを維持する
- integration test で Prev / Next 相当ナビゲーション後に visible range が対象ブロックを含むことを検証した

### Phase 12: Uncovered Files Sidebar ✅

- Activity Bar サイドバーに `Uncovered Files` view を追加し、walkthrough キャッシュ未作成の対象ファイルを一覧できるようにした
- `SidebarDataService` でワークスペースを走査し、`codeWalker.extensions` / `codeWalker.skipPatterns` に従って未登録ファイルを抽出するようにした
- `Walkthrough Explorer` 側の file description に `Registered` と Manual / Auto / Mixed 件数を表示し、登録済み / 未登録の見分けと source 内訳を付きやすくした
- integration test で未登録ファイルの列挙と open 動作を検証した

### Phase 12+: Highlight Restore Stabilization ✅

- 復元ライフサイクルを active editor 依存から広げ、起動時の visible editors、`onDidOpenTextDocument`、`onDidChangeVisibleTextEditors` でも restore を試行するようにした
- `restoredUris` と in-flight restore 状態を分離し、初回 restore miss 後に tracked 状態が残って再試行不能になる経路を塞いだ
- stored decoration が残っている visible editor には再適用を行い、タブ切替や可視化タイミングでハイライトが抜けにくいようにした
- integration test で restore miss 後に tracked 状態が残らず direct restore を再試行できることを検証した

### Phase 13: Symbol Drift Repair Initial Slice ✅

- Sidebar `Repair Walkthrough` で stale block を選ぶと、まず現在のシンボル定義行との差分から一括シフト候補を作るようにした
- 対象 block の `blockHash` が新しい行範囲で一致する場合は、説明・注釈・source を保持したまま cache の start/end line を自動更新する
- 定義行が変わらないケースでも、current symbol 内で target block の `blockHash` が一意一致すれば、その block だけ新しい行範囲へ自動再配置する
- 安全に自動修復できないが候補を提示できるケースでは `Repair Preview` を開き、候補選択または edit/import 継続を選べるようにした
- 候補も作れないケースだけ、従来どおり edit/import パネルへフォールバックする
- `CodeWalker: Repair Walkthrough` コマンドを追加し、active editor 上の stale block を command palette から直接修復できるようにした
- stale block の CodeLens に `[🛠]` repair 導線を追加し、sidebar を開かずに修復を起動できるようにした
- integration test で TypeScript 関数の定義行シフト、一意 hash 再配置、曖昧 hash 候補 preview 選択の各ケースを end-to-end で検証した

---


## 保留事項

### C2: ブロック範囲破損時の検出

| # | ユーザー操作 | 期待される挙動 | 現状の挙動 | 状態 |
|---|---|---|---|---|
| 1 | ブロック**前**に行追加 | startLine/endLine +1 | ✅ 両方 +1 | OK |
| 2 | ブロック**内**に行追加 | endLine +1 | ✅ endLine +1 | OK |
| 3 | ブロック**後**に行追加 | 変化なし | ✅ 変化なし | OK |
| 4 | ブロック**前**の行削除 | startLine/endLine -1 | ✅ 両方 -1 | OK |
| 5 | ブロック**内**の行削除 | endLine -1 | ✅ endLine -1 | OK |
| 6 | ブロック**全行**を削除 | エントリ削除 or 警告 | ✅ 保存時検証で ⚠ 付与 | 対応済 |
| 7 | ブロック範囲を跨いで削除 | 影響ブロックを削除 or 警告 | ✅ 保存時検証で ⚠ 付与 | 対応済 |
| 8 | Undo | 元の行番号に復帰 | ✅ delta 逆方向適用 | OK |
| 9 | ファイル保存 | 変化なし | ✅ 変化なし | OK |
| 10 | ファイルクローズ | clearUri で全データ削除 | ✅ clearUri 呼び出し | OK |
| 11 | 大量のペースト | delta 分だけ一括調整 | ✅ delta ベースで調整 | OK |
| 12 | ブロック跨ぎのカット&ペースト | 影響ブロックを警告 or 削除 | ✅ 保存時検証で ⚠ 付与 | 対応済 |

- **#6, #7, #12** について **C2-F（保存時検証）** を実装済み。ブロック消滅・逆転・重複を保存時に検出し ⚠ を付与する。ユーザーが手動で削除 or 再解析する運用とし、自動削除は非破壊の観点から見送り

---

## アーキテクチャ課題 (resolved)

> Phase 5 リファクタリングで全 4 件を解決済み。ビルドパス確認済み。

### 問題点と解決

| # | 問題 | 状態 | 解決内容 |
|---|---|---|---|
| A-1 | **extension.ts 肥大化** (451行) | ✅ 解決 | 7 コマンドハンドラを `src/commands/` に抽出。extension.ts は 451→136 行に縮小（DI 配線 + 登録のみ） |
| A-2 | **キャッシュ I/O 分散** | ✅ 解決 | `src/cache/cacheService.ts` (122行) を新設。6 箇所の重複を統合。`readFile()`, `writeFile()`, `deleteFile()`, `deleteDir()`, `deleteSubDir()` API |
| A-3 | **CodeLensProvider 責務過多** | ✅ 解決 | `src/walker/blockStore.ts` (155行) にデータストア + CRUD + イベント通知を分離。CodeLensProvider は 224→92 行の表示専門ラッパーに |
| A-4 | **循環参照リスク** | ✅ 解決 | `highlightTool.ts → extension.ts` の逆参照を排除。BlockStore をコンストラクタ注入に変更。`import { codeLensProvider } from '../extension'` は 0 件 |

### 適用したリファクタリング

| 対象 | 内容 | 結果 |
|---|---|---|
| `src/commands/` 新設 (7+1 ファイル) | clearHighlights / showBlockDetail / toggleAnnotations / clearCache / addBlock / editBlock / deleteBlock + index.ts | extension.ts 451→136 行 |
| `src/cache/cacheService.ts` 新設 | 全キャッシュ I/O を `CacheService` クラスに統合。`CacheSubDir` 型で `walks-manual`/`walks-auto` を型安全に区分 | 6 箇所の重複解消 |
| コンストラクタ DI | BlockStore / CacheService を `activate()` で生成し全ツール・コマンドにコンストラクタ or 引数で注入 | 循環参照 0 件、テスタビリティ向上 |
| `src/walker/blockStore.ts` 新設 | CodeLensProvider からデータストア + CRUD + 解説管理 + ハッシュフラグ + `onDidChange` イベントを分離 | CodeLensProvider 224→92 行 |

### 保留中のリファクタリング

（全件解決済み）

---

## 今後の課題

| # | 項目 | 説明 | 状態 |
|---|---|---|---|
| 7 | **テスト** | ユニットテスト / 統合テスト。リファクタリング安全性の担保 | ✅ 実装済み |

---

## テスト実行結果

> 最終実行: 2026-04-28
> 手動確認: 2026-04-28 完了

### インテグレーションテスト（@vscode/test-electron + Mocha）

| テストファイル | テスト数 | Pass | Fail | 備考 |
|---|---|---|---|---|
| smoke.test.ts | 2 | 2 | 0 | 拡張機能アクティベート + コマンド登録 |
| uc3-manual.test.ts | 19 | 19 | 0 | BlockStore CRUD + CodeLens + B7/B8 動作確認 + C2 行番号追従 + C2-F 整合性検証 + defaultColor |
| uc4-cache.test.ts | 11 | 11 | 0 | CacheService CRUD + UC4.6 explanation 往復 + UC4.1 キャッシュ復元 + restore miss 再試行 |
| uc5-display.test.ts | 17 | 17 | 0 | ViewMode + clearHighlights + toggleAnnotations + annotationStyle + REV 回帰 + detail navigation reveal + direct repair |
| uc6-sidebar.test.ts | 13 | 13 | 0 | Sidebar Explorer + export / repair / clear cache 導線 + folder hierarchy + uncovered files + drift repair + repair preview |
| uc7-visualizations.test.ts | 2 | 2 | 0 | Symbol Graph / Timeline のデータ整形 |
| uc1-uc2-tools.test.ts | 10 | 10 | 0 | ツール層データフロー + B4 動作確認 |
| **合計** | **74** | **74** | **0** | |

### ユニットテスト（vitest）

| テストファイル | テスト数 | Pass | Fail | 備考 |
|---|---|---|---|---|
| smoke.test.ts | 2 | 2 | 0 | vitest 動作確認 + vscode モック |
| notifications.test.ts | 2 | 2 | 0 | notificationTimeoutSeconds の timed fallback 検証 |
| **合計** | **4** | **4** | **0** | |

### バグ検出状況

| バグ | テスト結果 | 診断ログ | 解説 |
|---|---|---|---|
| B1 | ✅ **PASS（修正済み）** | `[DIAG:B1]` | restoreCache ライフサイクルのデッドコードを修正。extension.ts の return 位置を修正 |
| B2 | — テスト対象外 | — | package.json 設定修正のみ。現在は二重登録なし。以前の二重表示は Publisher 違いによる二重インストールが原因 |
| B3 | — テスト対象外 | — | プロンプト改善のみ。レベル別ブロック分割ルールを追加 |
| B4 | ✅ PASS（修正済み） | `[DIAG:B4]` | analyze 開始時に stale BlockStore データをクリア。Export キャンセル時の CodeLens 残存は仕様 |
| B5 | ✅ PASS（修正済み） | `[DIAG:B5]` | source 引数の明示渡しで解消。全 setBlocks 呼出しで source を明示指定済み |
| B6 | ✅ PASS（修正済み） | `[DIAG:B6]` | B5 と同根。source=undefined の経路が全て塞がれている |
| B7 | ✅ PASS（修正済み） | `[DIAG:B7]` | blockEditPanel で保存後即座に setBlocks + onDidChange.fire で CodeLens 再描画 |
| B8 | ✅ PASS（修正済み） | `[DIAG:B8]` | エラーメッセージにファイル名・シンボル名・インデックスを追加 |
| B9 | ✅ 対応済み | — | `codeWalker.enableDebugLog` 設定を追加。デフォルト OFF、動的切替可能 |
| B10 | — テスト対象外 | — | プロンプトに startLine 配置ルールを追加済み |

#### 診断ログによるバグ検出手順

1. Extension Development Host でエクステンションを起動
2. バグ再現操作を行う
3. ワークスペースルートに生成される `.code-walker-debug.log` を確認
4. `npm run analyze-log` でアナライザーを実行 → 検出レポート出力

### 自動テスト対象外（手動確認済み）

| ユースケース | 理由 |
|---|---|
| UC1.1 (analyze), UC1.4–1.5 (drilldown) | AI ツール直接呼出は E2E スコープ。手動確認済み |
| UC2.2 (targets.json 編集後再読込) | ユーザー操作 + AI 連携の E2E スコープ。手動確認済み |
| UC3.7 (Markdown プレビュー) | Webview レンダリング検証は E2E スコープ。手動確認済み |
| UC5.5–5.9 (Clear Cache QuickPick) | QuickPick UI 操作が必要。手動確認済み |
| UC5.11 (Compare Walkthroughs) | Webview 差分表示の E2E スコープ。手動確認済み |
| UC5.12 (ナビゲーション) | ブロック間移動の UI 検証。手動確認済み |
| UC1.9 / UC2.1 (Symbol Provider) | Language Server 未起動時はスキップ |

---

## バグ・課題一覧

| # | 分類 | 概要 | 原因分析 | 状態 |
|---|---|---|---|---|
| B1 | **バグ** | codewalk-all 完了後、最終ファイルの CodeLens クリックで「ブロック情報なし」 | `extension.ts` の `return` 位置を修正 | ✅ 修正済み |
| B2 | **バグ** | Add Block (Manual) がコマンドパレット・右クリックメニューに 2 つ表示 | Publisher 違いによる二重インストールが原因。package.json に二重登録なし | ✅ 解消済み |
| B3 | **課題** | codewalk-all の function / class / file レベルの違いが体感できない | プロンプトに「レベル別ブロック分割ルール」セクションを追加。function=ロジックフロー分割、class=メソッド単位分割、file=セクション単位分割と明確に指示 | ✅ 対応済み |
| B4 | **バグ** | codewalker 実行中に CodeLens クリックでブロック情報なし。また Export で「保存しない」を選んでも CodeLens が残る | analyze 開始時に stale な BlockStore データ + ハイライトをクリアするよう修正。Export キャンセル時の CodeLens 残存は仕様（ユーザーが確認し続けられる設計） | ✅ 修正済み |
| B5 | **バグ** | viewMode が both の時に CodeLens が二重表示される | Phase 7 で source 引数の明示渡し修正で解消 | ✅ 修正済み |
| B6 | **バグ** | viewMode が Manual Only でも Auto の CodeLens が表示される | B5 と同根。全 setBlocks 呼出で source 明示指定済み | ✅ 修正済み |
| B7 | **バグ** | Manual Block 保存直後に CodeLens クリックでブロック情報なし | blockEditPanel で保存後即座に setBlocks + onDidChange.fire で解消 | ✅ 修正済み |
| B8 | **改善** | 「ブロック情報が見つかりません」メッセージにパス情報がない | メッセージにファイル名・シンボル名・インデックスを追加 | ✅ 修正済み |
| B9 | **調査** | デバッグログが表示されない。ビルド時の ON/OFF 切替が可能か | `codeWalker.enableDebugLog` 設定を追加。デフォルト OFF、動的切替可能 | ✅ 対応済み |
| B10 | **課題** | CodeLens が関数定義行ではなく docstring やコード行に配置される | プロンプトに「最初のブロックの startLine はシンボルの定義行（def/function/class キーワード行）にする」ルールを追加。docstring やデコレータ行ではなく定義行を指定するよう明示 | ✅ 対応済み |
