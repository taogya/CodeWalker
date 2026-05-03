# REV-001: Current Project Findings

- 発見日: 2026-04-11
- レビュー範囲: `README.md`, `docs/design/docs/01-overview.md` から `docs/design/docs/07-usecases.md`, `docs/design/docs/99-status.md`, `package.json`, `src/`, `src/test/`
- 検証: `npm run compile`, `npm test` を実行し、いずれも成功

## Findings

| # | 分類 | 深刻度 | 対象 | 問題 | 根拠 | 主因 | 推奨対応 |
|---|---|---|---|---|---|---|---|
| 1 | 仕様・コード不整合 | 高 | `codeWalker.annotationStyle` | 設定として公開・文書化されているが、実行時に参照されず注釈スタイルが常に italic のままになる | `docs/design/docs/03-ui.md`, `docs/design/docs/06-settings.md`, `README.md`, `package.json`, `src/cache/configReader.ts`, `src/walker/highlighter.ts` | 設定反映漏れ | `highlighter` 側で設定を参照し、設定変更時の再描画を含めて実装する |
| 2 | 仕様・コード不整合 | 中 | `codeWalker.defaultColor` | 新規 Manual ブロックのデフォルト色を設定できる仕様だが、`Add Block` は常に `colorIndex: 0` で開始する | `docs/design/docs/05-manual-mode.md`, `docs/design/docs/06-settings.md`, `README.md`, `package.json`, `src/commands/addBlock.ts`, `src/walker/blockEditPanel.ts` | 設定反映漏れ | `addBlockCommand` で `loadConfig().defaultColor` を反映し、回帰テストを追加する |
| 3 | 仕様・コード不整合 | 高 | Manual 削除フロー | docs では「同シンボルに Auto があればフォールバック表示」とあるが、最後の Manual ブロック削除時に Auto 側を再読込していない | `docs/design/docs/05-manual-mode.md`, `src/commands/deleteBlock.ts`, `src/cache/restoreCache.ts` | 削除後の再解決処理不足 | Manual 削除後に同シンボルの Auto キャッシュを再解決し、表示を復元する |
| 4 | コードバグ | 高 | `codeWalker.clearCache` の「現在のファイル」 | 「現在のファイル」削除なのに `blockStore.clear()` と `clearAllDecorations()` を呼び、開いている他ファイルの表示まで消してしまう | `docs/design/docs/04-cache.md`, `docs/design/docs/07-usecases.md`, `src/commands/clearCache.ts` | スコープを広げすぎたクリア処理 | URI 単位で BlockStore と decoration を削除する分岐に置き換える |
| 5 | コードバグ | 高 | `codeWalker.clearCache` の「シンボル」「Auto 全削除」「Manual 全削除」 | キャッシュファイルは消えるが、表示中のハイライト・注釈・BlockStore が十分に同期されず、エディタ表示が stale になり得る | `src/commands/clearCache.ts`, `src/walker/highlighter.ts`, `docs/design/docs/04-cache.md` | キャッシュ削除と表示更新の責務分断 | symbol / source 単位の表示クリア API を追加し、削除コマンドから必ず同期させる |
| 6 | コードバグ | 中 | 編集パネルのプレビュー注釈 | プレビューで追加した注釈は `setAnnotations()` で蓄積されるが、パネル close 時は `__preview__` のハイライトしか消さないため注釈が残留する | `src/walker/blockEditPanel.ts`, `src/walker/highlighter.ts` | プレビュー終了時の注釈クリーンアップ不足 | プレビュー専用注釈を分離管理し、dispose 時に除去する |
| 7 | 仕様バグ | 低 | README の設定説明 | README ではテンプレートラベルのデフォルトを「日本語 6 種」としているが、実際の既定値は英語ラベルになっている | `README.md`, `package.json`, `src/cache/configReader.ts` | ドキュメント更新漏れ | README の設定表を実装値に合わせて更新する |
| 8 | 仕様バグ | 低 | `docs/design/docs/99-status.md` の annotationStyle 記述 | `annotationStyle` を `opacity / fontSize / margin` と説明しているが、公開設定は `italic` / `normal` のみ | `docs/design/docs/99-status.md`, `package.json`, `docs/design/docs/06-settings.md` | 実装変更後の記述残り | `docs/design/docs/99-status.md` を現行仕様に合わせて整理する |

## Notes

- 現行の自動テストはすべて通過したため、上記のうち 3-6 は主に未テストの UI 同期や削除後遷移の欠陥です。
- 既存の `codewalker.prompt.md` と `codewalker-all.prompt.md` は今回のレビュー対象として読みましたが、破壊的変更は加えていません。