# 06 — 設定リファレンス

[← 目次](./README.md)

---

## 概要

CodeWalker の設定は VS Code の標準設定機構（`contributes.configuration`）で管理する。  
`settings.json` またはUI設定画面（`Ctrl+,` → "CodeWalker" で検索）から変更可能。

---

## 設定一覧

### codeWalker.templateLabels

ブロック編集 Webview で表示されるラベルテンプレート候補。チップボタンとして表示され、クリックで入力される。

| 項目 | 値 |
|---|---|
| 型 | `string[]` |
| デフォルト | `["Initialization", "Validation", "Main Logic", "Error Handling", "Cleanup", "Helper"]` |

```json
"codeWalker.templateLabels": ["Setup", "Validation", "Core Logic", "Error Handling", "Cleanup"]
```

---

### codeWalker.defaultColor

Manual ブロック新規作成時のデフォルト色インデックス。

| 項目 | 値 |
|---|---|
| 型 | `number` (0–5) |
| デフォルト | `0`（青） |

| 値 | 色 |
|---|---|
| 0 | 青 |
| 1 | 緑 |
| 2 | 紫 |
| 3 | オレンジ |
| 4 | 赤 |
| 5 | シアン |

```json
"codeWalker.defaultColor": 2
```

---

### codeWalker.annotationStyle

行末アノテーションのフォントスタイル。

| 項目 | 値 |
|---|---|
| 型 | `"italic"` \| `"normal"` |
| デフォルト | `"italic"` |

```json
"codeWalker.annotationStyle": "normal"
```

---

### codeWalker.viewMode

起動時のデフォルト表示モード。セッション中は `codeWalker.setViewMode` コマンドで変更可能。

| 項目 | 値 |
|---|---|
| 型 | `"both"` \| `"manual-only"` \| `"auto-only"` |
| デフォルト | `"both"` |

| 値 | 説明 |
|---|---|
| `both` | Manual + Auto 両方表示 |
| `manual-only` | Manual ブロックのみ表示 |
| `auto-only` | Auto ブロックのみ表示 |

```json
"codeWalker.viewMode": "manual-only"
```

---

### codeWalker.notificationTimeoutSeconds

保存、削除、比較失敗、stale 警告などの非対話通知を自動で閉じるまでの秒数。`0` を指定すると従来どおり通知を残し続ける。

| 項目 | 値 |
|---|---|
| 型 | `number` |
| デフォルト | `3` |
| 最小値 | `0` |

```json
"codeWalker.notificationTimeoutSeconds": 5
```

---

### codeWalker.skipPatterns

バッチ処理（`list_symbols`）でスキップするファイル／ディレクトリを指定する正規表現パターンの配列。ファイルパスに対して `RegExp.test()` でマッチ判定される。

| 項目 | 値 |
|---|---|
| 型 | `string[]`（正規表現） |
| デフォルト | 下記参照 |

デフォルト値:

```json
"codeWalker.skipPatterns": [
  "node_modules",
  "\\.min\\.(js|css)$",
  "/dist/",
  "/build/",
  "/out/",
  "__pycache__",
  "\\.pyc$",
  "\\.d\\.ts$",
  "\\.generated\\.",
  "\\.g\\.",
  "/vendor/",
  "/\\.git/",
  "/\\.vscode/",
  "/\\.code-walker/"
]
```

---

### codeWalker.extensions

バッチ処理（`list_symbols`）で対象とするファイル拡張子の配列。

| 項目 | 値 |
|---|---|
| 型 | `string[]` |
| デフォルト | 下記参照 |

デフォルト値:

```json
"codeWalker.extensions": [
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".java", ".go", ".rs", ".cs",
  ".rb", ".php", ".swift", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp"
]
```

---

### codeWalker.enableLineTracking

エディタ編集時にブロックの startLine/endLine を自動追従するかどうか。保存時のブロック整合性検証（C2-F）もこの設定に連動。

| 項目 | 値 |
|---|---|
| 型 | `boolean` |
| デフォルト | `true` |

```json
"codeWalker.enableLineTracking": false
```

---

### codeWalker.enableDebugLog

デバッグログ出力の ON/OFF。有効時は OutputChannel に詳細ログを出力。動的切替可能。

| 項目 | 値 |
|---|---|
| 型 | `boolean` |
| デフォルト | `false` |

```json
"codeWalker.enableDebugLog": true
```

---

## 設定の適用タイミング

| 設定 | 適用タイミング |
|---|---|
| `templateLabels` | 編集 Webview を開くたびに読み込み |
| `defaultColor` | 編集 Webview を開くたびに読み込み |
| `annotationStyle` | 注釈描画時に参照し、設定変更時は既存の注釈表示を再描画 |
| `viewMode` | 拡張機能の起動時に 1 回読み込み。セッション中の変更は `setViewMode` コマンドで行う |
| `notificationTimeoutSeconds` | 通知表示時に都度参照 |
| `skipPatterns` | `list_symbols` ツール実行時に読み込み |
| `extensions` | `list_symbols` ツール実行時に読み込み |
| `enableLineTracking` | `onDidChangeTextDocument` / `onDidSaveTextDocument` リスナーで都度参照 |
| `enableDebugLog` | 設定変更時に動的切替 |

> 設定変更後に VS Code の再起動は不要（`viewMode` のみ起動時読み込みのため、反映にはコマンドによる切替が必要）。
