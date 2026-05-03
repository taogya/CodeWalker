# ユースケース一覧

> 最終更新: 2026-04-28

現行のテストカタログと、自動テスト対象外だが手動確認済みのフローをまとめる。
2026-04-28 時点の自動テスト結果は Integration 74 件、Unit 4 件で全件 pass。

## テスト可能レイヤー

| レイヤー | 実行環境 | Copilot API 消費 | 備考 |
|---|---|---|---|
| **Unit** | vitest（Node.js） | なし | 純粋ロジックと通知制御 |
| **Integration** | @vscode/test-electron + Mocha | なし | 実 VS Code 内でコマンド / cache / sidebar / Webview 連携を検証 |
| **E2E** | 手動確認 | あり | Copilot Chat Agent を含むチャットオーケストレーション |

## 自動テストの現在地

| 種別 | テストファイル | 件数 | 主な対象 |
|---|---|---:|---|
| Integration | `smoke.test.ts` | 2 | アクティベート、コマンド登録 |
| Integration | `uc1-uc2-tools.test.ts` | 10 | analyze / highlight / export / listSymbols のツール層データフロー |
| Integration | `uc3-manual.test.ts` | 19 | Manual mode、line tracking、block validation |
| Integration | `uc4-cache.test.ts` | 11 | CacheService、restore lifecycle、explanation 往復 |
| Integration | `uc5-display.test.ts` | 17 | ViewMode、clear / toggle、repair command、detail navigation |
| Integration | `uc6-sidebar.test.ts` | 13 | Sidebar Explorer、stale repair、repair preview、uncovered files、folder hierarchy |
| Integration | `uc7-visualizations.test.ts` | 2 | Symbol Graph、Timeline |
| Unit | `smoke.test.ts` | 2 | vitest 基本動作と vscode mock |
| Unit | `notifications.test.ts` | 2 | `notificationTimeoutSeconds` の timed fallback |
| **合計** |  | **78** | Integration 74 + Unit 4 |

---

## UC0: スモークテスト

テストファイル: `smoke.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 0.1 | ✅ | 拡張機能が正常にアクティベートされる |
| 0.2 | ✅ | 主要コマンドが登録されている |

---

## UC1: 対話ウォークスルー（ツール層）

テストファイル: `uc1-uc2-tools.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 1.2 | ✅ | HighlightTool がブロック登録、CodeLens、解説保持を行う |
| 1.6 | ✅ | ExportTool(JSON) が `.code-walker/` に正しい形式で保存する |
| 1.8 | ✅ | Export を保存しない場合でも BlockStore は維持され、cache は空のまま |
| 1.9 | ✅ | `executeWorkspaceSymbolProvider` 経由でシンボル検索できる |
| B4a | ✅ | Highlight 前に `showBlockDetail` を呼んでも壊れない |
| B4b | ✅ | Export キャンセル後も BlockStore と CodeLens が残る |

### 手動確認済みの対話フロー

| ケース | 状態 | 内容 |
|---|---|---|
| 1.1 | ✅ 手動確認済み | Copilot Agent からの analyze 起点フロー全体 |
| 1.3 | ✅ 手動確認済み | CodeLens クリックから Detail Webview を開く操作感 |
| 1.4 | ✅ 手動確認済み | drilldown による質問ループ |
| 1.5 | ✅ 手動確認済み | 質問終了から export 選択へ遷移する会話フロー |
| 1.7 | ✅ 手動確認済み | Markdown export の UI 選択と出力確認 |

---

## UC2: バッチウォークスルー（ツール層）

テストファイル: `uc1-uc2-tools.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 2.1 | ✅ | `executeDocumentSymbolProvider` と `list_symbols` 相当のターゲット生成 |
| 2.3 | ✅ | 複数シンボルを順次処理して BlockStore と cache に登録 |
| 2.4 | ✅ | 途中まで処理された cache を使って再開できる |
| 2.5 | ✅ | バッチ完了後に CodeLens がクリック可能な状態で残る |
| 2.2 | ✅ 手動確認済み | 編集後の `targets.json` を Agent が再読込して対象更新 |

---

## UC3: マニュアルモード

テストファイル: `uc3-manual.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 3.1 | ✅ | Add Block で Manual block を作成し CodeLens を表示 |
| 3.2 | ✅ | explanation を保存 / 取得できる |
| 3.3 | ✅ | BlockStore から block 情報を正しく参照できる |
| 3.4 | ✅ | block 編集で BlockStore が更新される |
| 3.5 | ✅ | block 削除と symbol 削除で index / symbol が整合する |
| 3.6 | ✅ | Auto block を Manual として上書きできる |
| REV-2 | ✅ | `codeWalker.defaultColor` が初期色に反映される |
| B7 | ✅ | 削除済み blockIndex で詳細表示しても壊れない |
| B8 | ✅ | 存在しない block の詳細表示でも壊れない |
| C2.1-C2.4 | ✅ | 行挿入 / 行削除による startLine / endLine 自動追従 |
| C2.5-C2.8 | ✅ | 0 行 / 逆転 / 重複 block の保存時検証 |
| 3.7 | ✅ 手動確認済み | Edit Webview 上の入力 UX と preview 操作 |

---

## UC4: キャッシュ復元とライフサイクル

テストファイル: `uc4-cache.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 4.1 | ✅ | cache が存在するファイルを開くと自動復元される |
| 4.2 | ✅ | Manual と Auto が両方ある場合も同一シンボルで共存復元される |
| 4.3 | ✅ | `blockHash` 不一致を検出して stale 扱いにする |
| 4.5 | ✅ | CacheService の read / write / delete / deleteSubDir |
| 4.6 | ✅ | explanation の往復保存 |
| 4.7 | ✅ | 初回 restore miss 後も tracked 状態が残らず再試行できる |
| 4.4 | ✅ 手動確認済み | ファイルクローズ → 再オープンの実運用ライフサイクル |

---

## UC5: 表示制御と管理コマンド

テストファイル: `uc5-display.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 5.1-5.3 | ✅ | ViewMode: Both / ManualOnly / AutoOnly |
| 5.4 | ✅ | `clearHighlights` で BlockStore と装飾をクリア |
| 5.10 | ✅ | `toggleAnnotations` がエラーなく動作 |
| 5.11 | ✅ | stale block の CodeLens に repair 導線 `[🛠]` が付く |
| 5.12 | ✅ | `Repair Walkthrough` コマンドが active editor の stale block を直接修復 |
| REV-1 | ✅ | `annotationStyle` 変更で注釈スタイルが再適用される |
| REV-3 | ✅ | 最後の Manual block 削除後に Auto cache へフォールバック |
| REV-4 | ✅ | 現在ファイル削除が他ファイルの表示状態を壊さない |
| REV-5 | ✅ | symbol 削除と Auto 全削除が対象範囲だけに効く |
| REV-6 | ✅ | preview 用シンボルを消すと preview 注釈も消える |
| FEAT-009 | ✅ | Detail Panel の Prev / Next 相当ナビゲーションで editor reveal が追従する |

### 追加で手動確認済みの項目

| ケース | 状態 | 内容 |
|---|---|---|
| compareWalkthroughs | ✅ 手動確認済み | 比較結果 Webview の見た目と差分確認導線 |
| clearCache QuickPick | ✅ 手動確認済み | 5 択 QuickPick からの選択 UX |

---

## UC6: Sidebar Explorer

テストファイル: `uc6-sidebar.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 6.1 | ✅ | Walkthrough Explorer が file → symbol → block 階層を構築 |
| 6.2 | ✅ | Stale Queue が `blockHash` 不一致シンボルだけを抽出 |
| 6.3 | ✅ | Batch Targets が pending / done / skip を表示 |
| 6.4 | ✅ | open / detail コマンドでファイルと詳細を開ける |
| 6.5 | ✅ | export コマンドで symbol Markdown を出力 |
| 6.6 | ✅ | clear cache コマンドで symbol 単位削除 |
| 6.7 | ✅ | stale な Auto block は import モードで edit panel へフォールバック |
| 6.8 | ✅ | Walkthrough Explorer でフォルダ階層を辿れる |
| 6.9 | ✅ | Batch Targets で status 配下をフォルダ階層表示 |
| 6.10 | ✅ | Uncovered Files が未登録ファイルのみ列挙 |
| 6.11 | ✅ | Sidebar repair が定義行シフトを自動修復 |
| 6.12 | ✅ | Sidebar repair が symbol 内 block 再配置を `blockHash` で自動修復 |
| 6.13 | ✅ | Sidebar repair が曖昧な hash 一致候補を Repair Preview で選択適用 |

---

## UC7 / UC8: Graph と Timeline

テストファイル: `uc7-visualizations.test.ts`

| ケース | 状態 | 内容 |
|---|---|---|
| 7.1 | ✅ | Symbol Graph が walkthrough / targets / import / reference を統合 |
| 8.1 | ✅ | Timeline が複数 snapshot root を時系列ポイントへ正規化 |

---

## 自動テスト対象外だが手動確認済みの主なフロー

| 分類 | 内容 |
|---|---|
| Agent E2E | `codewalker` / `codewalker-all` の会話オーケストレーション全体 |
| Webview UX | Edit Webview の preview / 保存導線、Compare / Graph / Timeline / Repair Preview の見た目 |
| Manual confirmation | QuickPick や通知メッセージなどの細かな対話 UX |

> 自動テスト件数の詳細は [99-status.md](./99-status.md) を正本とし、この文書では「どのフローをどのスイートで見ているか」を追いやすくすることを優先する。
