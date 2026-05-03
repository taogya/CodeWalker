# 02 — ツール設計

[← 目次](./README.md)

---

## ツール一覧

| ツール | モード | 役割 |
|---|---|---|
| analyze | Auto | シンボル解析 → 色分け → CodeLens → キャッシュ読込 |
| highlight | Auto | AI ブロック定義 → 注釈 → 解説保存 |
| drilldown | Auto | QuickPick 質問入力 / ESC 終了 |
| export | Auto / Batch | JSON / Markdown エクスポート |
| find_symbol | 共通 | ワークスペース横断シンボル検索 |
| list_symbols | Batch | フォルダ再帰シンボル列挙 + targets.json |

---

## code_walker_analyze

```typescript
// 入力
{ filePath: string; symbolName: string; depth?: number;
  startLine?: number; endLine?: number }

// 返却
{ sourceCode, range, blocks, childSymbols, systemContext,
  cachedWalkthrough? }
```

| 副作用 | 詳細 |
|---|---|
| ハイライト | 6 色パレットで暫定ブロック色分け |
| CodeLens | ブロックラベルをシンボル単位で登録 |
| キャッシュ | walks-manual → walks-auto の順で読込 |

---

## code_walker_highlight

```typescript
// 入力
{ filePath: string; symbolName: string;
  blocks?: Block[]; annotations?: Annotation[];
  explanations?: Explanation[] }
```

| パラメータ | 効果 |
|---|---|
| blocks | AI 意味的分割で色分け + CodeLens 上書き（`source: 'auto'` で登録） |
| annotations | 行末に `← テキスト` 表示（蓄積マージ） |
| explanations | CodeLens に解説保存 → Webview 表示 |

**symbolName 解決順**: 入力 → walkState → `'unknown'`

> BlockStore への登録時に `source: 'auto'` を付与。ViewMode フィルタリングに使用される。

---

## code_walker_drilldown

```typescript
// 入力
{ message?: string }
// 返却
{ finished: boolean; question?: string }
```

- QuickPick でテキスト入力 → `question` 返却
- ESC → `finished: true`

---

## code_walker_export

```typescript
// 入力
{ filePath: string; symbolName: string; overview: string;
  blocks: ExportBlock[]; batchMode?: boolean }
```

| モード | 動作 |
|---|---|
| 通常 | QuickPick で JSON / Markdown / Both / Cancel 選択 |
| batchMode | QuickPick スキップ、JSON 自動保存 + `targets.json` の status を `done` に更新 |

保存先: `walks-auto/{relPath}.json`（read-modify-write パターン）

### バッチ中断・再開

batchMode 成功時に `markTargetDone(filePath, symbolName)` が呼ばれ、`targets.json` の該当エントリの status が `done` に更新される。中断後に `list_symbols` を `fromFile` モードで再実行すると、`status=pending` のエントリのみが返される。

---

## code_walker_find_symbol

```typescript
// 入力
{ query: string; maxResults?: number }
// 返却
{ symbols: { name, filePath, line, kind }[] }
```

ワークスペース全体の `DocumentSymbol` から名前一致検索。

---

## code_walker_list_symbols

```typescript
// 入力
{ path: string; level?: 'function'|'class'|'file';
  extensions?: string[]; fromFile?: string }
```

| 機能 | 詳細 |
|---|---|
| 走査 | フォルダ再帰、拡張子ホワイトリスト、スキップパターン（設定連動） |
| targets.json | `.code-walker/targets.json` に自動保存 + エディタ表示 |
| 編集可能 | ユーザーが `status` を `skip` に変更して除外可 |
| fromFile | 編集済み targets.json 再読込（`status=pending` のみ返却） |
| 設定連動 | `codeWalker.extensions` / `codeWalker.skipPatterns` を参照 |

### targets.json スキーマ

```jsonc
{
  "version": "1.0",
  "createdAt": "2026-02-25T12:00:00Z",
  "config": { "path": "src/", "level": "class", "extensions": [".py"] },
  "targets": [
    { "filePath": "src/app.py", "symbolName": "main",
      "kind": "function", "line": 10, "endLine": 45,
      "status": "pending" }
  ]
}
```

`status` 値: `pending` | `skip` | `done`
