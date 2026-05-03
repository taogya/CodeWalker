# FEAT-009: Block Detail Navigation Sync

- 優先度: 中
- 状態: 実装済

## Current Slice

- Block Detail の Prev / Next 相当ナビゲーションでエディタ表示位置が対象ブロックへ追従する
- `showBlockDetailCommand` の reveal オプションで通常表示と navigation 表示を分離した
- Webview 側のフォーカスを維持しながら `preserveFocus` 付きで editor reveal する
- integration test で visible range が対象ブロックを含むことを検証済み

## Problem

Block Detail Webview の Prev / Next は現在パネル内の内容だけを切り替えるため、エディタ側の表示位置が元のまま残ります。ブロックの説明を順に読みながらコード本体も追いたい場面では、毎回手でスクロールし直す必要があり、文脈を見失いやすいです。

## User Value

- Prev / Next に合わせてエディタも対象ブロックへ追従する
- 解説と実コードを並べて読むときの往復操作が減る
- Manual / Auto を跨いだ確認でも、どのブロックを見ているか迷いにくい

## Scope

- Block Detail Webview の Prev / Next 操作にエディタ追従を追加する
- 必要なら別ファイルのブロックへ移動したときも対象ファイルを開いて reveal する
- フォーカスは Webview に残したまま、エディタは `preserveFocus` 付きで追従できるようにする
- 既存の show detail 導線、CodeLens、Sidebar、Graph、Timeline から開いた詳細パネルでも同じ挙動にする

### Out Of Scope

- Block Detail Webview 自体の UI 全面改修
- 複数ブロックの同時比較 UI
- `.code-walker` キャッシュ構造の変更

## Proposed UX

1. Block Detail で Prev / Next を押す
2. Webview の内容更新と同時に、エディタが該当ブロックの開始行付近までスクロールする
3. フォーカスは Webview に残し、キーボード連打でも読み進められるようにする
4. 必要なら設定で「Prev / Next 時はエディタにフォーカスを移す」を将来追加できる余地を残す

## Technical Outline

- `blockDetailPanel` の navigation callback から `showBlockDetailCommand` だけでなく editor reveal を呼べるようにする
- `showBlockDetailCommand` に「詳細表示のみ」と「詳細表示 + editor reveal」を分けるオプションを追加するか、専用 helper を切り出す
- `vscode.window.showTextDocument(..., { preview: false, preserveFocus: true })` と `TextEditor.revealRange(...)` を利用する
- `BlockStore` や `CacheService` はそのまま使い、表示ロジックだけを拡張する
- `.code-walker` のデータ構造、既存 `codewalker` / `codewalker-all` プロンプト契約、Graph / Timeline の snapshot 形式は変更しない

## Test Strategy

- navigation callback 実行時に対象 URI と blockIndex が正しく解決される integration テスト
- Prev / Next 操作後に active editor の visible range が対象ブロックへ寄ることを確認する integration テスト
- Graph / Timeline / Sidebar から Block Detail を開いた場合も同じ helper を通って reveal される回帰テスト

## Open Questions

- Prev / Next 時のデフォルトフォーカスは Webview 維持で十分か
- 別ファイルへ跨ぐ navigation を許可する場合、editor column を固定するか
- reveal の粒度を `InCenter` にするか `AtTop` にするか