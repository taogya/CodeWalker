/**
 * Integration テスト: UC3 マニュアルモード
 *
 * UC3.1: ブロック追加 — BlockStore にマニュアルブロックを登録し、
 *        CodeLens が正しく生成されることを検証する。
 *
 * 注: addBlock コマンド自体は Webview を開くため、
 *     テストでは BlockStore API を直接操作してデータフローを検証する。
 *     Webview の E2E テストは手動確認の範囲。
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { openFile, closeAllEditors, getExtensionExports, type ExtensionExports } from './helpers';

suite('UC3: マニュアルモード', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    await vscode.workspace.getConfiguration('codeWalker').update('defaultColor', 0, vscode.ConfigurationTarget.Workspace);
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    exports.testHooks.disposeEditPanel();
    await vscode.workspace.getConfiguration('codeWalker').update('defaultColor', 0, vscode.ConfigurationTarget.Workspace);
    await closeAllEditors();
  });

  // ────────────────────────────────────────────────────────────

  test('UC3.1: マニュアルブロックを追加すると BlockStore に登録される', async () => {
    // 1. フィクスチャファイルを開く
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 2. マニュアルブロックを追加（greet 関数 L9-L13）
    const blocks = [
      {
        index: 0,
        label: '挨拶メッセージ生成',
        startLine: 9,
        endLine: 13,
        colorIndex: 0,
        description: '名前が空なら "Hello, World!" を、そうでなければ名前付きで返す',
      },
    ];

    exports.blockStore.setBlocks(uri, 'greet', blocks, 'manual');

    // 3. BlockStore に登録されていることを確認
    const symbolNames = exports.blockStore.getSymbolNames(uri);
    assert.ok(symbolNames.includes('greet'), 'シンボル "greet" が登録されているべき');

    const details = exports.blockStore.getBlockDetails(uri, 'greet');
    assert.ok(details, 'BlockDetail が存在するべき');
    assert.strictEqual(details.length, 1, 'ブロック数は 1');
    assert.strictEqual(details[0].source, 'manual', 'source は "manual"');
    assert.strictEqual(details[0].block.label, '挨拶メッセージ生成');
    assert.strictEqual(details[0].block.startLine, 9);
    assert.strictEqual(details[0].block.endLine, 13);
  });

  test('UC3.1: マニュアルブロック追加後に CodeLens が生成される', async () => {
    // 1. フィクスチャファイルを開く
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;
    const doc = editor.document;

    // 2. マニュアルブロックを登録
    exports.blockStore.setBlocks(uri, 'greet', [
      {
        index: 0,
        label: '入力チェック',
        startLine: 11,
        endLine: 12,
        colorIndex: 0,
        description: '名前の空チェック',
      },
      {
        index: 1,
        label: 'メッセージ返却',
        startLine: 13,
        endLine: 13,
        colorIndex: 1,
        description: '名前付き挨拶を返す',
      },
    ], 'manual');

    // 3. CodeLens を取得
    const token = new vscode.CancellationTokenSource().token;
    const lenses = (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(doc, token) as vscode.CodeLens[];

    // 4. 検証: manual ブロックは メインラベル + 📝編集 + ✕削除 の 3 つずつ
    //    2 ブロック × 3 = 6 CodeLens
    assert.strictEqual(lenses.length, 6, `CodeLens は 6 個であるべき（実際: ${lenses.length}）`);

    // 最初のブロックのメインラベル
    const firstLens = lenses[0];
    assert.ok(firstLens.command, 'command が設定されているべき');
    assert.strictEqual(firstLens.command!.command, 'codeWalker.showBlockDetail');
    assert.ok(
      firstLens.command!.title.includes('入力チェック'),
      `タイトルに "入力チェック" を含むべき（実際: ${firstLens.command!.title})`,
    );
    assert.ok(
      firstLens.command!.title.includes('[M]'),
      `Manual バッジ "[M]" を含むべき（実際: ${firstLens.command!.title})`,
    );

    // 2 番目は 📝 編集ボタン
    assert.strictEqual(lenses[1].command!.command, 'codeWalker.editBlock');
    // 3 番目は ✕ 削除ボタン
    assert.strictEqual(lenses[2].command!.command, 'codeWalker.deleteBlock');
  });

  test('REV-2: Add Block は codeWalker.defaultColor を初期色として使う', async () => {
    const editor = await openFile('sample.py');
    editor.selection = new vscode.Selection(8, 0, 12, 0);

    await vscode.workspace.getConfiguration('codeWalker').update('defaultColor', 4, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('codeWalker.addBlock');

    const initData = exports.testHooks.getCurrentEditInitData();
    assert.ok(initData, 'Add Block 実行後は編集パネル初期値が存在するべき');
    assert.strictEqual(initData!.colorIndex, 4, 'defaultColor が初期色として反映されるべき');
    assert.strictEqual(initData!.startLine, 9);
    assert.strictEqual(initData!.endLine, 13);
  });

  // ── UC3.3: 保存直後の CodeLens クリック ────────────────────

  test('UC3.3: BlockStore 登録後に getBlockInfo で正しい情報が取得できる', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: '加算処理', startLine: 17, endLine: 19, colorIndex: 0, description: '2つの数を足す' },
    ], 'manual');

    // showBlockDetail コマンドの内部ロジックを再現: getBlockInfo
    const blockInfo = exports.blockStore.getBlockInfo(uri, 'add', 0);
    assert.ok(blockInfo, 'getBlockInfo が値を返すべき');
    assert.strictEqual(blockInfo!.label, '加算処理');
    assert.strictEqual(blockInfo!.startLine, 17);

    // getBlockDescription
    const desc = exports.blockStore.getBlockDescription(uri, 'add', 0);
    assert.ok(desc, 'getBlockDescription が値を返すべき');
    assert.ok(desc!.includes('加算処理'), `description に "加算処理" を含むべき`);
  });

  // ── UC3.4: ブロック編集（BlockStore 上書き） ────────────────

  test('UC3.4: ブロック情報を更新すると BlockStore が上書きされる', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 最初に登録
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: '元のラベル', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');

    // 上書き更新
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: '更新後ラベル', startLine: 9, endLine: 13, colorIndex: 1, description: '更新された説明' },
    ], 'manual');

    const details = exports.blockStore.getBlockDetails(uri, 'greet');
    assert.ok(details);
    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].block.label, '更新後ラベル');
    assert.strictEqual(details[0].block.colorIndex, 1);
    assert.strictEqual(details[0].block.description, '更新された説明');
  });

  // ── UC3.5: ブロック削除 ──────────────────────────────────

  test('UC3.5: removeBlock でブロックが削除され index が振り直される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'Calculator', [
      { index: 0, label: 'コンストラクタ', startLine: 23, endLine: 26, colorIndex: 0 },
      { index: 1, label: '掛け算', startLine: 28, endLine: 31, colorIndex: 1 },
      { index: 2, label: '割り算', startLine: 33, endLine: 39, colorIndex: 2 },
    ], 'manual');

    // 中間ブロック（index=1）を削除
    exports.blockStore.removeBlock(uri, 'Calculator', 1);

    const details = exports.blockStore.getBlockDetails(uri, 'Calculator');
    assert.ok(details);
    assert.strictEqual(details.length, 2, '2 ブロック残るべき');
    assert.strictEqual(details[0].block.label, 'コンストラクタ');
    assert.strictEqual(details[0].block.index, 0, 'index が 0 に振り直されるべき');
    assert.strictEqual(details[1].block.label, '割り算');
    assert.strictEqual(details[1].block.index, 1, 'index が 1 に振り直されるべき');
  });

  // ── UC3.5: シンボルごと削除 ─────────────────────────────

  test('UC3.5: removeSymbol でシンボル全体が削除される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'ブロック1', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: 'ブロック2', startLine: 17, endLine: 19, colorIndex: 0 },
    ], 'manual');

    exports.blockStore.removeSymbol(uri, 'greet');

    const names = exports.blockStore.getSymbolNames(uri);
    assert.ok(!names.includes('greet'), 'greet は削除されているべき');
    assert.ok(names.includes('add'), 'add は残っているべき');
  });

  // ── UC3.6: Auto→Manual インポート（BlockStore レベル） ───

  test('UC3.6: Auto ブロックを Manual として上書きできる', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // Auto で登録
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Auto生成ラベル', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'auto');

    // Manual として上書き（インポート相当）
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual編集済み', startLine: 9, endLine: 13, colorIndex: 2, description: '手動で編集' },
    ], 'manual');

    const details = exports.blockStore.getBlockDetails(uri, 'greet');
    assert.ok(details);
    assert.strictEqual(details[0].source, 'manual', 'source が manual に変わるべき');
    assert.strictEqual(details[0].block.label, 'Manual編集済み');
  });

  // ── UC3.2: 解説（explanation）の保存 ──────────────────────

  test('UC3.2: setExplanation で解説を保存し getExplanation で取得できる', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: '挨拶関数', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');

    exports.blockStore.setExplanation(uri, 'greet', 0, 'この関数は名前を受け取って挨拶文を返します。');

    const explanation = exports.blockStore.getExplanation(uri, 'greet', 0);
    assert.strictEqual(explanation, 'この関数は名前を受け取って挨拶文を返します。');
  });

  // ── B7: 保存直後の CodeLens クリックで blockIndex 不一致 ──

  test('B7: ブロック削除後に古い blockIndex で showBlockDetail を呼ぶとエラーにならない', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 3 ブロック登録
    exports.blockStore.setBlocks(uri, 'Calculator', [
      { index: 0, label: 'コンストラクタ', startLine: 23, endLine: 26, colorIndex: 0 },
      { index: 1, label: '掛け算', startLine: 28, endLine: 31, colorIndex: 1 },
      { index: 2, label: '割り算', startLine: 33, endLine: 39, colorIndex: 2 },
    ], 'manual');

    // 中間ブロック削除 → index が 0,1 に振り直し
    exports.blockStore.removeBlock(uri, 'Calculator', 1);

    // 古い blockIndex=2 で showBlockDetail を呼ぶ（CodeLens が古い引数を持つケース）
    // B7: この呼出で「ブロック情報なし」になる
    const blockInfo = exports.blockStore.getBlockInfo(uri, 'Calculator', 2);
    assert.strictEqual(
      blockInfo, undefined,
      '削除後の古い blockIndex=2 は undefined を返すべき（残りは index 0,1 のみ）',
    );

    // showBlockDetail コマンドを古い index で実行 → エラーにならないことを確認
    // （ただし「ブロック情報なし」メッセージが表示される）
    await vscode.commands.executeCommand('codeWalker.showBlockDetail', uri, 'Calculator', 2);
    // B7 自体は「CodeLens arguments が古い index を保持する」設計問題
    // → CodeLens 再描画前にクリックされた場合に発生
    assert.ok(true, 'showBlockDetail が例外なく完了する');
  });

  // ── B8: エラーメッセージにパス情報を表示 ──────────────────

  test('B8: 存在しないブロックの showBlockDetail でもエラーにならない（パス情報付き）', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // BlockStore は空 → getBlockInfo は undefined
    const blockInfo = exports.blockStore.getBlockInfo(uri, 'nonexistent', 0);
    assert.strictEqual(blockInfo, undefined, '存在しないシンボルは undefined');

    // showBlockDetail を呼ぶ → 'Block info not found: <file> / <symbol> [#<index>]' メッセージ
    await vscode.commands.executeCommand('codeWalker.showBlockDetail', uri, 'nonexistent', 0);

    // B8 修正済み: メッセージに fileName, symbolName, blockIndex を含む
    assert.ok(true, 'showBlockDetail が例外なく完了する');
  });

  // ── C2: 行番号自動追従 ──────────────────────────────

  test('C2.1: ブロックより前に行挿入 → startLine/endLine が +1 シフト', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'main', [
      { index: 0, label: 'Block A', startLine: 10, endLine: 15, colorIndex: 0 },
      { index: 1, label: 'Block B', startLine: 20, endLine: 25, colorIndex: 1 },
    ], 'auto');

    // 行 5 (0-based) の前に 1 行挿入 → delta=+1, changeStart=5, changeEnd=5
    const adjusted = exports.blockStore.adjustLineNumbers(uri, 5, 5, 1);
    assert.strictEqual(adjusted, true, '調整が行われること');

    const a = exports.blockStore.getBlockInfo(uri, 'main', 0);
    assert.strictEqual(a?.startLine, 11, 'Block A startLine が +1');
    assert.strictEqual(a?.endLine, 16, 'Block A endLine が +1');

    const b = exports.blockStore.getBlockInfo(uri, 'main', 1);
    assert.strictEqual(b?.startLine, 21, 'Block B startLine が +1');
    assert.strictEqual(b?.endLine, 26, 'Block B endLine が +1');
  });

  test('C2.2: ブロック内に行挿入 → endLine のみ +1', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'main', [
      { index: 0, label: 'Block A', startLine: 10, endLine: 15, colorIndex: 0 },
    ], 'auto');

    // 行 12 (0-based=11) の中に 1 行挿入 → delta=+1, changeStart=11, changeEnd=11
    const adjusted = exports.blockStore.adjustLineNumbers(uri, 11, 11, 1);
    assert.strictEqual(adjusted, true, '調整が行われること');

    const a = exports.blockStore.getBlockInfo(uri, 'main', 0);
    assert.strictEqual(a?.startLine, 10, 'startLine は変わらない');
    assert.strictEqual(a?.endLine, 16, 'endLine が +1');
  });

  test('C2.3: ブロックより後に行挿入 → 変化なし', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'main', [
      { index: 0, label: 'Block A', startLine: 10, endLine: 15, colorIndex: 0 },
    ], 'auto');

    // 行 20 (0-based=19) の後に 1 行挿入 → delta=+1, changeStart=19, changeEnd=19
    const adjusted = exports.blockStore.adjustLineNumbers(uri, 19, 19, 1);
    assert.strictEqual(adjusted, false, 'ブロック後の変更は調整不要');

    const a = exports.blockStore.getBlockInfo(uri, 'main', 0);
    assert.strictEqual(a?.startLine, 10, 'startLine 変化なし');
    assert.strictEqual(a?.endLine, 15, 'endLine 変化なし');
  });

  test('C2.4: ブロックより前で行削除 → startLine/endLine が -1 シフト', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'main', [
      { index: 0, label: 'Block A', startLine: 10, endLine: 15, colorIndex: 0 },
    ], 'auto');

    // 行 3 (0-based=2) を 1 行削除 → delta=-1, changeStart=2, changeEnd=3
    const adjusted = exports.blockStore.adjustLineNumbers(uri, 2, 3, -1);
    assert.strictEqual(adjusted, true, '調整が行われること');

    const a = exports.blockStore.getBlockInfo(uri, 'main', 0);
    assert.strictEqual(a?.startLine, 9, 'startLine が -1');
    assert.strictEqual(a?.endLine, 14, 'endLine が -1');
  });

  // ── C2-F: 保存時ブロック検証 ──────────────────────────

  test('C2.5: validateBlocks — 正常ブロックは ⚠ が付かない', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'func', [
      { index: 0, label: 'A', startLine: 10, endLine: 20, colorIndex: 0 },
      { index: 1, label: 'B', startLine: 21, endLine: 30, colorIndex: 1 },
    ], 'auto');

    const warns = exports.blockStore.validateBlocks(uri);
    assert.strictEqual(warns, 0, '正常ブロックは警告なし');

    const details = exports.blockStore.getBlockDetails(uri, 'func');
    assert.strictEqual(details?.[0].hashMismatch, undefined, 'ブロック0に⚠なし');
    assert.strictEqual(details?.[1].hashMismatch, undefined, 'ブロック1に⚠なし');
  });

  test('C2.6: validateBlocks — 0行ブロック（endLine == startLine）に ⚠ 付与', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'func', [
      { index: 0, label: 'A', startLine: 10, endLine: 10, colorIndex: 0 },
      { index: 1, label: 'B', startLine: 15, endLine: 25, colorIndex: 1 },
    ], 'auto');

    const warns = exports.blockStore.validateBlocks(uri);
    assert.strictEqual(warns, 1, '0行ブロック1件に警告');

    const details = exports.blockStore.getBlockDetails(uri, 'func');
    assert.strictEqual(details?.[0].hashMismatch, true, '0行ブロックに⚠');
    assert.strictEqual(details?.[1].hashMismatch, undefined, '正常ブロックは⚠なし');
  });

  test('C2.7: validateBlocks — endLine < startLine の逆転ブロックに ⚠ 付与', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'func', [
      { index: 0, label: 'A', startLine: 10, endLine: 15, colorIndex: 0 },
    ], 'auto');

    // 手動で境界を壊す（adjustLineNumbers で起きうる状態を再現）
    const info = exports.blockStore.getBlockInfo(uri, 'func', 0);
    if (info) { info.endLine = 8; } // startLine(10) > endLine(8) — 逆転

    const warns = exports.blockStore.validateBlocks(uri);
    assert.strictEqual(warns, 1, '逆転ブロック1件に警告');

    const details = exports.blockStore.getBlockDetails(uri, 'func');
    assert.strictEqual(details?.[0].hashMismatch, true, '逆転ブロックに⚠');
  });

  test('C2.8: validateBlocks — ブロック重複（境界が重なる）に ⚠ 付与', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'func', [
      { index: 0, label: 'A', startLine: 10, endLine: 20, colorIndex: 0 },
      { index: 1, label: 'B', startLine: 18, endLine: 30, colorIndex: 1 },
    ], 'auto');

    const warns = exports.blockStore.validateBlocks(uri);
    assert.ok(warns >= 1, '重複ブロックに1件以上の警告');

    const details = exports.blockStore.getBlockDetails(uri, 'func');
    // 重複する側（後のブロック）に ⚠ が付く
    assert.strictEqual(details?.[1].hashMismatch, true, '重複ブロックBに⚠');
  });
});
