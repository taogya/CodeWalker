# 05 — マニュアルモード設計

[← 目次](./README.md)

> 最終更新: 2026-04-28

---

## 概要

ユーザーが手動でブロック定義・解説を作成するモード。  
AI 生成（Auto）とは独立した `walks-manual/` に保存され、Both 表示では同一シンボル内でも Manual と Auto が共存できる。

---

## ブロック追加フロー

```
[1] エディタでコード範囲を選択
       │
[2] 右クリック → 「CodeWalker: Add Block」
       │
[3] 編集 Webview パネルが右に開く
       │  ├── ラベル入力
       │  ├── 行範囲（選択範囲がプリセット）
       │  ├── 色選択（6 色パレット）
       │  ├── 概要・解説 (Markdown)
       │  └── 行末アノテーション
       │
[4] 💾 保存
       │  ├── walks-manual/{relPath}.json に書込
       │  ├── CodeLens [M] 表示
       │  └── ハイライト適用
       │
[5] CodeLens クリック → 閲覧 Webview で確認
```

---

## ブロック編集フロー

```
CodeLens [📝 編集] クリック
    │
    ├─ Manual ブロックの場合
    │   └── 既存データで編集 Webview を開く
    │
    └─ Auto ブロックの場合
        └── Auto データをプリセットして編集 Webview を開く
            └── 保存 → walks-manual/ に書込（Auto → Manual インポート）
```

- **Auto 側は一切変更しない**
- 編集 → 保存した時点で Manual 扱い
- 同一シンボルの Auto CodeLens / highlight は Both 表示では残る

---

## ブロック削除フロー

```
CodeLens [✕] クリック（Manual ブロックのみ表示）
    │
    ├─ 確認ダイアログ「ブロック "初期化処理" を削除しますか？」
    │
    └─ walks-manual/ から削除
        └─ 同シンボルに Auto があればフォールバック表示
```

> Auto ブロックには `[✕]` ボタンは表示されません。Auto キャッシュの削除は Clear Cache コマンドから行います。

---

## stale block の修復

Manual block でも `blockHash` が現在コードと一致しなくなった場合は stale 扱いになり、CodeLens と Sidebar の両方から修復できる。

| 導線 | 動作 |
|---|---|
| CodeLens `⚠ [🛠]` | active editor 上の stale block を修復 |
| Sidebar `Stale Queue` | stale file / symbol / block を選んで修復 |

修復時はまず安全な自動修復を試す。

- シンボル定義行がずれただけなら block 群と annotations を同じ delta で一括シフトする
- 定義行が変わらなくても current symbol 内で target block の `blockHash` が一意一致すれば、その block だけ再配置する
- 複数候補がある場合は Repair Preview で候補選択に回す
- 候補も作れない場合は既存の edit / import パネルへフォールバックする

---

## Manual / Auto 表示切替（ViewMode）

`codeWalker.setViewMode` コマンドまたはステータスバーから表示モードを切り替える。

| モード | 動作 |
|---|---|
| Both | Manual + Auto 両方表示（デフォルト） |
| Manual Only | Manual ブロックのみ表示 |
| Auto Only | Auto ブロックのみ表示 |

切替時に CodeLens とハイライトの両方が即座に再描画される。  
ステータスバーに現在モードがアイコン付きで表示される。  
起動時のデフォルトは設定 `codeWalker.viewMode` で変更可。

---

## Manual / Auto の共存

```
src/models/user.py
       ├── validate_user  → Manual [M] + Auto [A]
  ├── create_user    → Auto   [A]  （Manual 未作成）
       └── delete_user    → Manual [M]
```

Manual / Auto は source ごとに保存・表示状態を持つ。Both では同一シンボルの Manual block と Auto block を同時に表示し、Sidebar でも `[M]` / `[A]` 付きで両方の block を辿れる。

---

## 設定

マニュアルモードに関連する設定は VS Code Settings（`settings.json`）で管理する。

| 設定キー | 説明 | デフォルト |
|---|---|---|
| `codeWalker.templateLabels` | ラベル候補リスト | `["Initialization", "Validation", ...]` |
| `codeWalker.defaultColor` | 新規ブロックのデフォルト色 | `0`（青） |
| `codeWalker.viewMode` | 起動時の表示モード | `"both"` |

全設定の詳細は [06-settings.md](./06-settings.md) を参照。

---

## vs. Auto モード 比較

| 項目 | Auto | Manual |
|---|---|---|
| ブロック定義者 | AI (Copilot) | ユーザー |
| 保存先 | walks-auto/ | walks-manual/ |
| 色選択 | 自動 (0-5 循環) | ユーザー選択 |
| 編集 | 不可（再解析で上書き） | Webview で自由に編集 |
| CodeLens バッジ | [A] | [M] |
| Both での表示 | 表示される | 表示される |
| source 別フィルタ | Auto Only で表示 | Manual Only で表示 |
