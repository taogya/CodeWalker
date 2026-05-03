/**
 * Integration テスト: UC5 表示制御 & 管理コマンド
 *
 * UC5.1-5.3: ViewMode による CodeLens フィルタリング
 * UC5.4: Clear Highlights
 * UC5.10: Toggle Annotations（コマンドコール検証のみ）
 * UC5.5-5.9: Clear Cache（ファイルシステム操作を含む）
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { cleanCodeWalkerCache, closeAllEditors, getExtensionExports, openFile, patchWindowMethod, sleep, type ExtensionExports } from './helpers';

suite('UC5: 表示制御 & 管理コマンド', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    exports.blockStore.setViewMode('both');
    exports.testHooks.clearAllDecorations();
    exports.testHooks.disposeEditPanel();
    await vscode.workspace.getConfiguration('codeWalker').update('annotationStyle', 'italic', vscode.ConfigurationTarget.Workspace);
    cleanupDisplayTempFiles();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    exports.blockStore.setViewMode('both');
    exports.testHooks.clearAllDecorations();
    exports.testHooks.disposeEditPanel();
    await vscode.workspace.getConfiguration('codeWalker').update('annotationStyle', 'italic', vscode.ConfigurationTarget.Workspace);
    cleanupDisplayTempFiles();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  // ── ViewMode テスト用ヘルパー ──

  function registerMixedBlocks(uri: vscode.Uri): void {
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: 'Auto Block', startLine: 17, endLine: 19, colorIndex: 1 },
    ], 'auto');
  }

  function getCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const token = new vscode.CancellationTokenSource().token;
    return (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(doc, token) as vscode.CodeLens[];
  }

  // ── UC5.1: ViewMode Both ──────────────────────────────────

  test('UC5.1: ViewMode=Both で Auto・Manual 両方の CodeLens が表示される', async () => {
    const editor = await openFile('sample.py');
    registerMixedBlocks(editor.document.uri);
    exports.blockStore.setViewMode('both');

    const lenses = getCodeLenses(editor.document);

    // Manual: メイン + 📝 + ✕ = 3、Auto: メイン + 📥 = 2 → 合計 5
    assert.strictEqual(lenses.length, 5, `CodeLens は 5 個であるべき（実際: ${lenses.length}）`);

    const titles = lenses.map(l => l.command!.title);
    assert.ok(titles.some(t => t.includes('[M]')), 'Manual バッジが存在するべき');
    assert.ok(titles.some(t => t.includes('[A]')), 'Auto バッジが存在するべき');
  });

  // ── UC5.2: ViewMode ManualOnly ──────────────────────────

  test('UC5.2: ViewMode=ManualOnly で Manual の CodeLens のみ表示される', async () => {
    const editor = await openFile('sample.py');
    registerMixedBlocks(editor.document.uri);
    exports.blockStore.setViewMode('manual-only');

    const lenses = getCodeLenses(editor.document);

    // Manual のみ: メイン + 📝 + ✕ = 3
    assert.strictEqual(lenses.length, 3, `CodeLens は 3 個であるべき（実際: ${lenses.length}）`);
    const titles = lenses.map(l => l.command!.title);
    assert.ok(titles.some(t => t.includes('[M]')), 'Manual バッジが存在するべき');
    assert.ok(!titles.some(t => t.includes('[A]')), 'Auto バッジは存在しないべき');
  });

  // ── UC5.3: ViewMode AutoOnly ────────────────────────────

  test('UC5.3: ViewMode=AutoOnly で Auto の CodeLens のみ表示される', async () => {
    const editor = await openFile('sample.py');
    registerMixedBlocks(editor.document.uri);
    exports.blockStore.setViewMode('auto-only');

    const lenses = getCodeLenses(editor.document);

    // Auto のみ: メイン + 📥 = 2
    assert.strictEqual(lenses.length, 2, `CodeLens は 2 個であるべき（実際: ${lenses.length}）`);
    const titles = lenses.map(l => l.command!.title);
    assert.ok(!titles.some(t => t.includes('[M]')), 'Manual バッジは存在しないべき');
    assert.ok(titles.some(t => t.includes('[A]')), 'Auto バッジが存在するべき');
  });

  // ── B6: source 未設定ブロックの ViewMode フィルタ ──
  // 注: codeLensProvider のフィルタロジック自体は正しく動作する（PASS）。
  //     B6 の実バグは restoreCache が古いキャッシュ（source フィールド欠損）を
  //     読み込む際に source=undefined のままBlockStoreに登録するケース。
  //     → B1（restoreCache デッドコード）修正後に restoreCache 経由のテストで再現可能。

  test('B6: source 未設定のブロックは ManualOnly でフィルタされるべき', async () => {
    const editor = await openFile('sample.py');

    // source を指定せずに setBlocks（undefined）
    exports.blockStore.setBlocks(uri(editor), 'greet', [
      { index: 0, label: 'No Source', startLine: 9, endLine: 13, colorIndex: 0 },
    ]);  // source = undefined

    exports.blockStore.setViewMode('manual-only');
    const lenses = getCodeLenses(editor.document);

    // source===undefined は 'manual' でも 'auto' でもないため、
    // manual-only では detail.source !== 'manual' → true → スキップされる
    // → フィルタロジック自体は正しい（PASS）
    assert.strictEqual(
      lenses.length, 0,
      `source 未設定ブロックは ManualOnly で表示されないべき（実際: ${lenses.length}）`,
    );
  });

  // ── UC5.4: Clear Highlights ─────────────────────────────

  test('UC5.4: clearHighlights コマンドで BlockStore がクリアされる', async () => {
    const editor = await openFile('sample.py');
    exports.blockStore.setBlocks(editor.document.uri, 'greet', [
      { index: 0, label: 'テスト', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');

    assert.strictEqual(exports.blockStore.getSymbolNames(editor.document.uri).length, 1);

    await vscode.commands.executeCommand('codeWalker.clearHighlights');

    const names = exports.blockStore.getSymbolNames(editor.document.uri);
    assert.strictEqual(names.length, 0, 'clearHighlights 後は BlockStore が空であるべき');
  });

  test('B5: 同一シンボルを Auto→Manual で登録すると両 source の CodeLens が共存する', async () => {
    const editor = await openFile('sample.py');
    const fileUri = editor.document.uri;

    // 同一シンボル 'greet' に Auto で登録
    exports.blockStore.setBlocks(fileUri, 'greet', [
      { index: 0, label: 'Auto版', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'auto');

    // 同一シンボル 'greet' に Manual を追加
    exports.blockStore.setBlocks(fileUri, 'greet', [
      { index: 0, label: 'Manual版', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');

    exports.blockStore.setViewMode('both');
    const lenses = getCodeLenses(editor.document);

    // 同一シンボルでも source が異なれば共存: Manual 3 + Auto 2 = 5
    assert.strictEqual(lenses.length, 5, `両 source が共存して 5 個であるべき（実際: ${lenses.length}）`);
    const titles = lenses.map(l => l.command?.title ?? '');
    assert.ok(titles.some(title => title.includes('[M]')), 'Manual CodeLens が残るべき');
    assert.ok(titles.some(title => title.includes('[A]')), 'Auto CodeLens も残るべき');
  });

  test('REV-10: Auto を Manual として保存しても Auto の CodeLens とハイライトは残る', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto greet',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{
            label: 'Auto Greet',
            startLine: 9,
            endLine: 13,
            colorIndex: 1,
            explanation: 'auto explanation',
            annotations: [{ line: 10, text: 'auto annotation' }],
          }],
        },
      },
    });

    await exports.restoreFromCache(editor, exports.blockStore, exports.cacheService);
    let lenses = getCodeLenses(editor.document);
    assert.strictEqual(lenses.length, 2, '保存前は Auto CodeLens だけが見えるべき');

    await vscode.commands.executeCommand('codeWalker.editBlock', uri, 'greet', 0, true);
    const initData = exports.testHooks.getCurrentEditInitData();
    assert.ok(initData, 'import パネル初期値が取得できるべき');
    assert.strictEqual(initData!.isImport, true, 'Auto import モードで開くべき');

    await exports.testHooks.saveCurrentEditPanelForTest({
      symbolName: 'greet',
      label: 'Manual Greet',
      startLine: 9,
      endLine: 13,
      colorIndex: 2,
      description: 'manual description',
      explanation: 'manual explanation',
      annotations: [{ line: 10, text: 'manual annotation' }],
    });
    await sleep(100);

    const details = exports.blockStore.getBlockDetails(uri, 'greet');
    assert.ok(details, '保存後もシンボルが残るべき');
    assert.deepStrictEqual(
      details!.map(detail => [detail.source, detail.block.label]),
      [['manual', 'Manual Greet'], ['auto', 'Auto Greet']],
      '保存後は Manual と Auto が共存するべき',
    );

    lenses = getCodeLenses(editor.document);
    assert.strictEqual(lenses.length, 5, '保存後は Manual 3 + Auto 2 の CodeLens が見えるべき');
    assert.deepStrictEqual(
      exports.testHooks.getStoredSymbolNames(uri).sort(),
      ['greet::auto', 'greet::manual'],
      'source ごとのハイライト owner が両方残るべき',
    );
    assert.deepStrictEqual(
      exports.testHooks.getStoredAnnotationOwners(uri).sort(),
      ['greet::auto', 'greet::manual'],
      'source ごとの注釈 owner も両方残るべき',
    );
  });

  // ── UC5.10: Toggle Annotations コマンド実行可能 ──────────

  test('UC5.10: toggleAnnotations コマンドがエラーなく実行できる', async () => {
    await openFile('sample.py');
    // 2 回トグル（ON→OFF→ON）でエラーが出ないことを確認
    await vscode.commands.executeCommand('codeWalker.toggleAnnotations');
    await vscode.commands.executeCommand('codeWalker.toggleAnnotations');
    assert.ok(true, 'toggleAnnotations が例外なく実行できた');
  });

  test('UC5.11: stale block の CodeLens には repair 導線が追加される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setBlockHashMismatch(uri, 'greet', 0, true);

    const lenses = getCodeLenses(editor.document);
    assert.strictEqual(lenses.length, 4, `stale manual block は 4 個の CodeLens を持つべき（実際: ${lenses.length}）`);
    assert.strictEqual(lenses[0].command?.command, 'codeWalker.showBlockDetail');
    assert.strictEqual(lenses[1].command?.command, 'codeWalker.repairWalkthrough');
    assert.strictEqual(lenses[2].command?.command, 'codeWalker.editBlock');
    assert.strictEqual(lenses[3].command?.command, 'codeWalker.deleteBlock');
  });

  test('REV-1: annotationStyle 設定変更で注釈スタイルが再適用される', async () => {
    const editor = await openFile('sample.py');

    exports.testHooks.setAnnotations(editor, [{ line: 10, text: 'annotation' }], 'greet');
    assert.strictEqual(exports.testHooks.getCurrentAnnotationStyle(), 'italic');

    await vscode.workspace.getConfiguration('codeWalker').update('annotationStyle', 'normal', vscode.ConfigurationTarget.Workspace);
    await sleep(50);

    assert.strictEqual(exports.testHooks.getCurrentAnnotationStyle(), 'normal', '設定変更後は normal が再適用されるべき');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(editor.document.uri), ['greet'], '設定変更後も注釈所有者は維持されるべき');
  });

  test('REV-4: Clear Cache の現在ファイル削除は他ファイルの表示状態を消さない', async () => {
    const editorPy = await openFile('sample.py');
    const uriPy = editorPy.document.uri;
    exports.blockStore.setBlocks(uriPy, 'greet', [
      { index: 0, label: 'Python Manual', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.testHooks.highlightBlocks(editorPy, [{ range: new vscode.Range(8, 0, 12, 0), colorIndex: 0 }], 'greet');

    const editorTs = await openFile('sample.ts');
    const uriTs = editorTs.document.uri;
    exports.blockStore.setBlocks(uriTs, 'greet', [
      { index: 0, label: 'TS Manual', startLine: 1, endLine: 6, colorIndex: 0 },
    ], 'manual');
    exports.testHooks.highlightBlocks(editorTs, [{ range: new vscode.Range(0, 0, 5, 0), colorIndex: 0 }], 'greet');

    await exports.cacheService.writeFile('walks-manual', 'sample.ts', {
      version: '1.0',
      filePath: 'sample.ts',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'ts',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'TS Manual', startLine: 1, endLine: 6, colorIndex: 0 }],
        },
      },
    });

    const restoreQuickPick = patchWindowMethod('showQuickPick', async () => ({ value: 'file' }));
    try {
      await vscode.commands.executeCommand('codeWalker.clearCache');
    } finally {
      restoreQuickPick();
    }

    assert.strictEqual(exports.blockStore.getSymbolNames(uriTs).length, 0, '現在ファイルの BlockStore は消えるべき');
    assert.deepStrictEqual(exports.blockStore.getSymbolNames(uriPy), ['greet'], '他ファイルの BlockStore は残るべき');
    assert.deepStrictEqual(exports.testHooks.getStoredSymbolNames(uriTs), [], '現在ファイルのハイライト状態は消えるべき');
    assert.deepStrictEqual(exports.testHooks.getStoredSymbolNames(uriPy), ['greet'], '他ファイルのハイライト状態は残るべき');
  });

  test('REV-5: Clear Cache のシンボル削除は対象シンボルだけを表示状態から除去する', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: 'Auto Block', startLine: 17, endLine: 19, colorIndex: 1 },
    ], 'auto');
    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(8, 0, 12, 0), colorIndex: 0 }], 'greet');
    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(16, 0, 18, 0), colorIndex: 1 }], 'add');
    exports.testHooks.setAnnotations(editor, [{ line: 10, text: 'manual annotation' }], 'greet');
    exports.testHooks.setAnnotations(editor, [{ line: 17, text: 'auto annotation' }], 'add');

    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0, annotations: [{ line: 10, text: 'manual annotation' }] }],
        },
      },
    });
    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        add: {
          symbolName: 'add',
          overview: 'auto',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Block', startLine: 17, endLine: 19, colorIndex: 1, annotations: [{ line: 17, text: 'auto annotation' }] }],
        },
      },
    });

    const restoreQuickPick = patchWindowMethod('showQuickPick', async (...args: unknown[]) => {
      if (Array.isArray(args[0]) && (args[0] as Array<{ value?: string }>)[0]?.value) {
        return { value: 'symbol' };
      }
      return { label: 'greet' };
    });
    try {
      await vscode.commands.executeCommand('codeWalker.clearCache');
    } finally {
      restoreQuickPick();
    }

    assert.deepStrictEqual(exports.blockStore.getSymbolNames(uri), ['add'], '削除対象以外のシンボルは残るべき');
    assert.deepStrictEqual(exports.testHooks.getStoredSymbolNames(uri), ['add'], 'ハイライト状態も対象シンボルだけ消えるべき');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(uri), ['add'], '注釈状態も対象シンボルだけ残るべき');
  });

  test('REV-5: Clear Cache の Auto 全削除は Manual を残して Auto だけ除去する', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: 'Auto Block', startLine: 17, endLine: 19, colorIndex: 1 },
    ], 'auto');
    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(8, 0, 12, 0), colorIndex: 0 }], 'greet');
    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(16, 0, 18, 0), colorIndex: 1 }], 'add');
    exports.testHooks.setAnnotations(editor, [{ line: 10, text: 'manual annotation' }], 'greet');
    exports.testHooks.setAnnotations(editor, [{ line: 17, text: 'auto annotation' }], 'add');

    const restoreQuickPick = patchWindowMethod('showQuickPick', async () => ({ value: 'project-auto' }));
    try {
      await vscode.commands.executeCommand('codeWalker.clearCache');
    } finally {
      restoreQuickPick();
    }

    assert.deepStrictEqual(exports.blockStore.getSymbolNames(uri), ['greet'], 'Manual シンボルは残るべき');
    assert.deepStrictEqual(exports.testHooks.getStoredSymbolNames(uri), ['greet'], 'ハイライト状態は Manual だけ残るべき');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(uri), ['greet'], '注釈状態も Manual だけ残るべき');
  });

  test('REV-6: プレビュー用シンボルをクリアするとプレビュー注釈も除去される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(8, 0, 12, 0), colorIndex: 0 }], '__preview__');
    exports.testHooks.setAnnotations(editor, [{ line: 10, text: 'preview annotation' }], '__preview__');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(uri), ['__preview__']);

    exports.testHooks.clearSymbol(editor, '__preview__');

    assert.deepStrictEqual(exports.testHooks.getStoredSymbolNames(uri), [], 'プレビューブロックは除去されるべき');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(uri), [], 'プレビュー注釈も除去されるべき');
  });

  test('REV-3: 最後の Manual ブロック削除後に Auto キャッシュへフォールバックする', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'manual');
    exports.blockStore.setExplanation(uri, 'greet', 0, 'manual explanation');
    exports.testHooks.highlightBlocks(editor, [{ range: new vscode.Range(8, 0, 12, 0), colorIndex: 0 }], 'greet');
    exports.testHooks.setAnnotations(editor, [{ line: 10, text: 'manual annotation' }], 'greet');

    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Block', startLine: 9, endLine: 13, colorIndex: 0, explanation: 'manual explanation', annotations: [{ line: 10, text: 'manual annotation' }] }],
        },
      },
    });
    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Block', startLine: 9, endLine: 13, colorIndex: 1, explanation: 'auto explanation', annotations: [{ line: 11, text: 'auto annotation' }] }],
        },
      },
    });

    const restoreWarning = patchWindowMethod('showWarningMessage', async () => 'Delete');
    try {
      await vscode.commands.executeCommand('codeWalker.deleteBlock', uri, 'greet', 0);
    } finally {
      restoreWarning();
    }

    const details = exports.blockStore.getBlockDetails(uri, 'greet');
    assert.ok(details, 'Auto フォールバック後もブロックが存在するべき');
    assert.strictEqual(details![0].source, 'auto', 'Auto キャッシュへフォールバックするべき');
    assert.strictEqual(details![0].block.label, 'Auto Block');
    assert.strictEqual(exports.blockStore.getExplanation(uri, 'greet', 0), 'auto explanation');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(uri), ['greet::auto'], 'フォールバック後の注釈が再登録されるべき');
  });

  test('FEAT-009: Block Detail の Prev/Next 相当ナビゲーションでエディタ表示位置が追従する', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    exports.blockStore.setBlocks(uri, 'Calculator', [
      { index: 0, label: 'Constructor', startLine: 23, endLine: 26, colorIndex: 0 },
      { index: 1, label: 'Multiply', startLine: 28, endLine: 31, colorIndex: 1 },
    ], 'manual');
    exports.blockStore.setExplanation(uri, 'Calculator', 0, 'constructor explanation');
    exports.blockStore.setExplanation(uri, 'Calculator', 1, 'multiply explanation');

    editor.revealRange(new vscode.Range(0, 0, 2, 0), vscode.TextEditorRevealType.AtTop);
    await vscode.commands.executeCommand('codeWalker.showBlockDetail', uri, 'Calculator', 0);
    assert.strictEqual(countOpenTextTabs(uri), 1, '詳細パネル表示直後は同一ファイルのタブが増えていないべき');

    await exports.testHooks.navigateDetailPanelBlock(uri, 'Calculator', 1);
    await sleep(100);

    assert.strictEqual(countOpenTextTabs(uri), 1, 'Prev/Next ナビゲーション後も同一ファイルのタブは 1 つのままであるべき');

    const visibleRange = vscode.window.activeTextEditor?.visibleRanges[0];
    assert.ok(visibleRange, 'active editor の visible range が取得できるべき');
    assert.ok(
      visibleRange!.start.line <= 27 && visibleRange!.end.line >= 30,
      '第二ブロックの行範囲が visible range に含まれるべき',
    );
  });

  test('UC5.12: Repair Walkthrough コマンドは active editor の stale block を直接修復できる', async () => {
    const repairPath = 'tmp-display/repair_command.ts';

    writeWorkspaceFile(repairPath, [
      'export function drifted() {',
      '  const value = 1;',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'));
    const editor = await openFile(repairPath);
    const originalHash = await computeBlockHashForFixture(repairPath, 1, 4);

    await exports.cacheService.writeFile('walks-manual', repairPath, {
      version: '1.0',
      filePath: repairPath,
      symbols: {
        drifted: {
          symbolName: 'drifted',
          overview: 'manual drifted',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{
            label: 'Main Logic',
            startLine: 1,
            endLine: 4,
            colorIndex: 0,
            explanation: 'repair me',
            annotations: [{ line: 2, text: 'value assignment' }],
            blockHash: originalHash,
          }],
        },
      },
    });

    await editor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(0, 0), '// inserted header\n\n');
    });
    await editor.document.save();

    await vscode.commands.executeCommand('codeWalker.repairWalkthrough');
    await sleep(150);

    const details = exports.blockStore.getBlockDetails(editor.document.uri, 'drifted');
    assert.ok(details, 'repair 後は BlockStore にブロックが残るべき');
    assert.strictEqual(details?.[0].block.startLine, 3, '開始行は新しい定義行へ移るべき');
    assert.strictEqual(details?.[0].block.endLine, 6, '終了行も同じ delta で移るべき');
    assert.strictEqual(details?.[0].hashMismatch, undefined, 'repair 後は stale フラグが消えるべき');
    assert.deepStrictEqual(exports.testHooks.getStoredAnnotationOwners(editor.document.uri), ['drifted::manual']);
  });
});

// ── ヘルパー ──
function uri(editor: vscode.TextEditor): vscode.Uri {
  return editor.document.uri;
}

function countOpenTextTabs(uri: vscode.Uri): number {
  return vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString())
    .length;
}

async function computeBlockHashForFixture(filePath: string, startLine: number, endLine: number): Promise<string> {
  const editor = await openFile(filePath);
  const lines: string[] = [];
  for (let lineNumber = startLine - 1; lineNumber <= endLine - 1; lineNumber++) {
    lines.push(editor.document.lineAt(lineNumber).text);
  }
  const hash = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  return `sha256:${hash}`;
}

function writeWorkspaceFile(relativePath: string, contents: string): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }

  const targetPath = path.join(workspaceFolder.uri.fsPath, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, 'utf-8');
}

function cleanupDisplayTempFiles(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  fs.rmSync(path.join(workspaceFolder.uri.fsPath, 'tmp-display'), { recursive: true, force: true });
}
