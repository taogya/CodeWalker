import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { cleanCodeWalkerCache, closeAllEditors, getExtensionExports, openFile, sleep, type ExtensionExports } from './helpers';
import { buildFilePathHierarchy } from '../../sidebar/treeHierarchy';

suite('UC6: Sidebar Explorer', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    exports.testHooks.clearAllDecorations();
    exports.testHooks.disposeEditPanel();
    exports.testHooks.disposeRepairPreviewPanel();
    cleanCodeWalkerCache();
    cleanupSidebarTempFiles();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    exports.testHooks.clearAllDecorations();
    exports.testHooks.disposeEditPanel();
    exports.testHooks.disposeRepairPreviewPanel();
    cleanCodeWalkerCache();
    cleanupSidebarTempFiles();
    await closeAllEditors();
  });

  test('UC6.1: Walkthrough Explorer は file -> symbol -> block 階層を構築する', async () => {
    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Greet', startLine: 9, endLine: 13, colorIndex: 0 }],
        },
      },
    });
    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto greet',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Greet', startLine: 9, endLine: 13, colorIndex: 1 }],
        },
        add: {
          symbolName: 'add',
          overview: 'auto add',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Add', startLine: 17, endLine: 19, colorIndex: 2 }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();

    assert.strictEqual(snapshot.walkthroughFiles.length, 1, 'sample.py の 1 ファイルだけが表示されるべき');
    assert.strictEqual(snapshot.walkthroughFiles[0].filePath, 'sample.py');
    assert.strictEqual(snapshot.walkthroughFiles[0].children.length, 2, 'greet と add の 2 シンボルが表示されるべき');
    assert.strictEqual(snapshot.walkthroughFiles[0].mixedSymbolCount, 1, 'mixed symbol 件数が反映されるべき');
    assert.strictEqual(snapshot.walkthroughFiles[0].autoSymbolCount, 1, 'auto symbol 件数が反映されるべき');
    assert.strictEqual(snapshot.walkthroughFiles[0].manualSymbolCount, 0, 'manual only symbol 件数が反映されるべき');

    const greet = snapshot.walkthroughFiles[0].children.find(symbol => symbol.symbolName === 'greet');
    assert.ok(greet, 'greet シンボルが存在するべき');
    assert.strictEqual(greet!.source, 'manual', 'mixed symbol node の primary source は manual 扱い');
    assert.strictEqual(greet!.hasManual, true);
    assert.strictEqual(greet!.hasAuto, true);
    assert.strictEqual(greet!.children[0].label, 'Manual Greet');
    assert.deepStrictEqual(
      greet!.children.map(block => [block.source, block.label]),
      [['manual', 'Manual Greet'], ['auto', 'Auto Greet']],
      'mixed symbol では Manual / Auto の両 block が見えるべき',
    );

    const add = snapshot.walkthroughFiles[0].children.find(symbol => symbol.symbolName === 'add');
    assert.ok(add, 'add シンボルが存在するべき');
    assert.strictEqual(add!.source, 'auto');
    assert.strictEqual(add!.children[0].label, 'Auto Add');
  });

  test('UC6.2: Stale Queue は blockHash 不一致のシンボルだけを抽出する', async () => {
    const actualHash = await computeBlockHashForFixture('sample.py', 17, 19);

    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Greet', startLine: 9, endLine: 13, colorIndex: 0, blockHash: 'sha256:stale_hash' }],
        },
        add: {
          symbolName: 'add',
          overview: 'manual add',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Add', startLine: 17, endLine: 19, colorIndex: 1, blockHash: actualHash }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();

    assert.strictEqual(snapshot.staleFiles.length, 1, 'stale ファイルは 1 件のべき');
    assert.strictEqual(snapshot.staleFiles[0].children.length, 1, 'stale シンボルだけが残るべき');
    assert.strictEqual(snapshot.staleFiles[0].children[0].symbolName, 'greet');
    assert.strictEqual(snapshot.staleFiles[0].children[0].children[0].stale, true);
  });

  test('UC6.3: Batch Targets は pending/done/skip を status ごとに表示する', async () => {
    await writeTargetsFile({
      version: '1.0',
      createdAt: new Date().toISOString(),
      config: { path: 'sample.py', level: 'function', extensions: ['.py'] },
      skipped: [],
      summary: {},
      targets: [
        { filePath: 'sample.py', symbolName: 'greet', kind: 'function', line: 9, status: 'pending' },
        { filePath: 'sample.py', symbolName: 'add', kind: 'function', line: 17, status: 'done' },
        { filePath: 'sample.py', symbolName: 'Calculator', kind: 'class', line: 22, status: 'skip' },
      ],
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();

    const pending = snapshot.targetGroups.find(group => group.status === 'pending');
    const done = snapshot.targetGroups.find(group => group.status === 'done');
    const skip = snapshot.targetGroups.find(group => group.status === 'skip');
    assert.strictEqual(pending?.children.length, 1);
    assert.strictEqual(done?.children.length, 1);
    assert.strictEqual(skip?.children.length, 1);
    assert.strictEqual(pending?.children[0].symbolName, 'greet');
  });

  test('UC6.4: Sidebar の open/detail コマンドからファイルと詳細を開ける', async () => {
    const actualHash = await computeBlockHashForFixture('sample.py', 9, 13);

    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Greet', startLine: 9, endLine: 13, colorIndex: 0, explanation: 'detail text', blockHash: actualHash }],
        },
      },
    });
    await writeTargetsFile({
      version: '1.0',
      createdAt: new Date().toISOString(),
      config: { path: 'sample.py', level: 'function', extensions: ['.py'] },
      skipped: [],
      summary: {},
      targets: [
        { filePath: 'sample.py', symbolName: 'greet', kind: 'function', line: 9, status: 'pending' },
      ],
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();
    const targetNode = snapshot.targetGroups.find(group => group.status === 'pending')!.children[0];
    const blockNode = snapshot.walkthroughFiles[0].children[0].children[0];

    await vscode.commands.executeCommand('codeWalker.sidebar.openNode', targetNode);
    assert.ok(vscode.window.activeTextEditor, 'openNode 実行後はエディタが開くべき');
    assert.strictEqual(vscode.workspace.asRelativePath(vscode.window.activeTextEditor!.document.uri, false), 'sample.py');

    await vscode.commands.executeCommand('codeWalker.sidebar.showNodeDetail', blockNode);
    await sleep(100);

    const editor = await openFile('sample.py');
    const details = exports.blockStore.getBlockDetails(editor.document.uri, 'greet');
    assert.ok(details, 'showNodeDetail 経由で BlockStore に symbol が復元されるべき');
    assert.strictEqual(details![0].block.label, 'Manual Greet');
  });

  test('UC6.5: Sidebar の export コマンドで symbol Markdown を出力できる', async () => {
    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet overview',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Greet', startLine: 9, endLine: 13, colorIndex: 0, explanation: 'detail text' }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();
    const blockNode = snapshot.walkthroughFiles[0].children[0].children[0];

    await vscode.commands.executeCommand('codeWalker.sidebar.exportNode', blockNode);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'workspace folder が必要');
    const markdownPath = path.join(workspaceFolder!.uri.fsPath, '.code-walker', 'walks-manual', 'sample.py', 'greet.md');
    assert.ok(fs.existsSync(markdownPath), 'Markdown エクスポートファイルが作成されるべき');

    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    assert.ok(markdown.includes('# greet — Walkthrough'));
    assert.ok(markdown.includes('Manual Greet'));
  });

  test('UC6.6: Sidebar の clear cache コマンドで symbol 単位のキャッシュを削除できる', async () => {
    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Manual Greet', startLine: 9, endLine: 13, colorIndex: 0 }],
        },
      },
    });
    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto greet',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Greet', startLine: 9, endLine: 13, colorIndex: 1 }],
        },
        add: {
          symbolName: 'add',
          overview: 'auto add',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Add', startLine: 17, endLine: 19, colorIndex: 2 }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshotBefore = await exports.testHooks.getSidebarSnapshot();
    const greetNode = snapshotBefore.walkthroughFiles[0].children.find(symbol => symbol.symbolName === 'greet');
    assert.ok(greetNode, '削除対象の symbol node が存在するべき');

    await vscode.commands.executeCommand('codeWalker.sidebar.clearNodeCache', greetNode);

    const snapshotAfter = await exports.testHooks.getSidebarSnapshot();
    const remainingSymbols = snapshotAfter.walkthroughFiles[0].children.map(symbol => symbol.symbolName);
    assert.deepStrictEqual(remainingSymbols, ['add']);

    const manualFile = await exports.cacheService.readFile('walks-manual', 'sample.py') as { symbols?: Record<string, unknown> } | null;
    const autoFile = await exports.cacheService.readFile('walks-auto', 'sample.py') as { symbols?: Record<string, unknown> } | null;
    assert.strictEqual(manualFile, null, 'manual 側は空になったのでファイルごと削除されるべき');
    assert.ok(autoFile, 'auto 側は add が残るのでファイルが残るべき');
    assert.deepStrictEqual(Object.keys(autoFile!.symbols ?? {}), ['add']);
  });

  test('UC6.7: Sidebar の repair コマンドは stale な Auto block を import モードで開く', async () => {
    await exports.cacheService.writeFile('walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto greet',
          updatedAt: new Date().toISOString(),
          source: 'auto',
          blocks: [{ label: 'Auto Greet', startLine: 9, endLine: 13, colorIndex: 1, blockHash: 'sha256:stale_hash' }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();
    const staleSymbol = snapshot.staleFiles[0].children[0];

    await vscode.commands.executeCommand('codeWalker.sidebar.repairNode', staleSymbol);
    await sleep(100);

    const initData = exports.testHooks.getCurrentEditInitData();
    assert.ok(initData, 'repair 実行後は編集パネル初期値が作られるべき');
    assert.strictEqual(initData!.symbolName, 'greet');
    assert.strictEqual(initData!.label, 'Auto Greet');
    assert.strictEqual(initData!.isImport, true, 'Auto block は import モードで開くべき');
    assert.strictEqual(initData!.blockIndex, -1, 'import モードでは新規 block 扱いになるべき');
  });

  test('UC6.8: Walkthrough Explorer はフォルダ階層を挟んで file -> symbol -> block を辿れる', async () => {
    const hierarchy = buildFilePathHierarchy(
      [
        {
          kind: 'walkthrough-file' as const,
          id: 'src/commands/addBlock.ts',
          filePath: 'src/commands/addBlock.ts',
          staleSymbolCount: 0,
          children: [
            {
              kind: 'walkthrough-symbol' as const,
              id: 'src/commands/addBlock.ts::addBlockCommand',
              filePath: 'src/commands/addBlock.ts',
              symbolName: 'addBlockCommand',
              source: 'manual' as const,
              hasManual: true,
              hasAuto: false,
              staleBlockCount: 0,
              children: [
                {
                  kind: 'walkthrough-block' as const,
                  id: 'src/commands/addBlock.ts::addBlockCommand::0',
                  filePath: 'src/commands/addBlock.ts',
                  symbolName: 'addBlockCommand',
                  blockIndex: 0,
                  label: 'Main Logic',
                  startLine: 1,
                  endLine: 10,
                  source: 'manual' as const,
                  stale: false,
                },
              ],
            },
          ],
        },
        {
          kind: 'walkthrough-file' as const,
          id: 'src/cache/cacheSnapshot.ts',
          filePath: 'src/cache/cacheSnapshot.ts',
          staleSymbolCount: 0,
          children: [],
        },
      ],
      'walkthrough::root',
    );

    assert.strictEqual(hierarchy.length, 1, 'root には src フォルダだけが見えるべき');
    assert.strictEqual(hierarchy[0].kind, 'folder');
    assert.strictEqual(hierarchy[0].label, 'src');

    const srcChildren = hierarchy[0].children;
    assert.deepStrictEqual(srcChildren.map(node => node.kind), ['folder', 'folder']);
    assert.deepStrictEqual(srcChildren.map(node => node.kind === 'folder' ? node.label : node.filePath), ['cache', 'commands']);

    const commandsFolder = srcChildren[1];
    assert.strictEqual(commandsFolder.kind, 'folder');
    const commandFiles = commandsFolder.children;
    assert.strictEqual(commandFiles[0].kind, 'walkthrough-file');
    assert.strictEqual(commandFiles[0].filePath, 'src/commands/addBlock.ts');
  });

  test('UC6.9: Batch Targets は status 配下をフォルダ階層で辿れる', async () => {
    const hierarchy = buildFilePathHierarchy(
      [
        {
          kind: 'target-entry' as const,
          id: 'pending::src/commands/addBlock.ts::addBlockCommand',
          filePath: 'src/commands/addBlock.ts',
          symbolName: 'addBlockCommand',
          targetKind: 'function',
          line: 12,
          status: 'pending' as const,
        },
        {
          kind: 'target-entry' as const,
          id: 'pending::src/cache/cacheSnapshot.ts::readAllCacheFilesFromRoot',
          filePath: 'src/cache/cacheSnapshot.ts',
          symbolName: 'readAllCacheFilesFromRoot',
          targetKind: 'function',
          line: 3,
          status: 'pending' as const,
        },
      ],
      'status::pending::root',
      entry => `${path.posix.basename(entry.filePath)}::${entry.symbolName}::${String(entry.line)}`,
    );

    assert.strictEqual(hierarchy[0].kind, 'folder');
    assert.strictEqual(hierarchy[0].label, 'src');

    const srcChildren = hierarchy[0].children;
    assert.deepStrictEqual(srcChildren.map(node => node.kind === 'folder' ? node.label : node.symbolName), ['cache', 'commands']);

    const commandsFolder = srcChildren[1];
    assert.strictEqual(commandsFolder.kind, 'folder');
    const commandTargets = commandsFolder.children;
    assert.strictEqual(commandTargets[0].kind, 'target-entry');
    assert.strictEqual(commandTargets[0].filePath, 'src/commands/addBlock.ts');
  });

  test('UC6.10: Uncovered Files は未登録ファイルだけを列挙し open できる', async () => {
    const uncoveredPath = 'tmp-sidebar/uncovered_case.py';
    const coveredPath = 'tmp-sidebar/covered_case.py';

    writeWorkspaceFile(uncoveredPath, 'def only_uncovered():\n    return 1\n');
    writeWorkspaceFile(coveredPath, 'def already_registered():\n    return 2\n');

    await exports.cacheService.writeFile('walks-manual', coveredPath, {
      version: '1.0',
      filePath: coveredPath,
      symbols: {
        already_registered: {
          symbolName: 'already_registered',
          overview: 'covered file',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Covered', startLine: 1, endLine: 2, colorIndex: 0 }],
        },
      },
    });

    await exports.testHooks.refreshSidebar();
    const snapshot = await exports.testHooks.getSidebarSnapshot();

    assert.ok(
      snapshot.uncoveredFiles.some(file => file.filePath === uncoveredPath),
      '未登録ファイルは Uncovered Files に出るべき',
    );
    assert.ok(
      !snapshot.uncoveredFiles.some(file => file.filePath === coveredPath),
      '登録済みファイルは Uncovered Files に出ないべき',
    );

    const uncoveredNode = snapshot.uncoveredFiles.find(file => file.filePath === uncoveredPath);
    assert.ok(uncoveredNode, 'open 用の uncovered node が取得できるべき');

    await vscode.commands.executeCommand('codeWalker.sidebar.openNode', uncoveredNode);

    const activeEditorPath = vscode.window.activeTextEditor
      ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false)
      : undefined;
    assert.strictEqual(activeEditorPath, uncoveredPath, 'Uncovered Files からファイルを開けるべき');
  });

  test('UC6.11: Sidebar の repair コマンドは定義行シフトを自動修復する', async () => {
    const repairPath = 'tmp-sidebar/repair_shift.ts';

    writeWorkspaceFile(repairPath, [
      'export function drifted() {',
      '  const value = 1;',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'));
    const originalHash = await computeBlockHashForFixture(repairPath, 1, 4);
    await closeAllEditors();

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
            explanation: 'shift me',
            annotations: [{ line: 2, text: 'value assignment' }],
            blockHash: originalHash,
          }],
        },
      },
    });

    writeWorkspaceFile(repairPath, [
      '// inserted header',
      '',
      'export function drifted() {',
      '  const value = 1;',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'));

    await openFile(repairPath);
    await sleep(150);

    await exports.testHooks.refreshSidebar();
    let snapshot = await exports.testHooks.getSidebarSnapshot();
    const staleSymbol = snapshot.staleFiles.find(file => file.filePath === repairPath)?.children[0];
    assert.ok(staleSymbol, 'shift 前のキャッシュは stale symbol として見えるべき');

    await vscode.commands.executeCommand('codeWalker.sidebar.repairNode', staleSymbol);
    await sleep(150);

    await exports.testHooks.refreshSidebar();
    snapshot = await exports.testHooks.getSidebarSnapshot();
    assert.ok(
      !snapshot.staleFiles.some(file => file.filePath === repairPath),
      'repair 後は stale queue から対象シンボルが消えるべき',
    );

    const manualFile = await exports.cacheService.readFile('walks-manual', repairPath) as {
      symbols?: Record<string, {
        blocks: Array<{
          startLine: number;
          endLine: number;
          annotations?: Array<{ line: number; text: string }>;
        }>;
      }>;
    } | null;
    const repairedBlock = manualFile?.symbols?.drifted?.blocks?.[0];
    assert.ok(repairedBlock, 'repair 後の block がキャッシュに残るべき');
    assert.strictEqual(repairedBlock!.startLine, 3, '開始行は新しい定義行へシフトされるべき');
    assert.strictEqual(repairedBlock!.endLine, 6, '終了行も同じ delta でシフトされるべき');
    assert.deepStrictEqual(
      repairedBlock!.annotations,
      [{ line: 4, text: 'value assignment' }],
      'annotations も同じ delta でシフトされるべき',
    );

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'workspace folder があるべき');
    const uri = vscode.Uri.joinPath(workspaceFolder!.uri, repairPath);
    const details = exports.blockStore.getBlockDetails(uri, 'drifted');
    assert.ok(details, 'repair 後は BlockStore に再ロードされるべき');
    assert.strictEqual(details?.[0].block.startLine, 3);
    assert.strictEqual(details?.[0].block.endLine, 6);
  });

  test('UC6.12: Sidebar の repair コマンドはシンボル内で移動した block を hash で自動修復する', async () => {
    const repairPath = 'tmp-sidebar/repair_hash_match.ts';

    writeWorkspaceFile(repairPath, [
      'export function drifted() {',
      '  const value = 1;',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'));
    const originalHash = await computeBlockHashForFixture(repairPath, 3, 3);
    await closeAllEditors();

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
            label: 'Return',
            startLine: 3,
            endLine: 3,
            colorIndex: 0,
            explanation: 'relocate me',
            annotations: [{ line: 3, text: 'return statement' }],
            blockHash: originalHash,
          }],
        },
      },
    });

    writeWorkspaceFile(repairPath, [
      'export function drifted() {',
      '  const value = 1;',
      '  const doubled = value * 2;',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'));

    await openFile(repairPath);
    await sleep(150);

    await exports.testHooks.refreshSidebar();
    let snapshot = await exports.testHooks.getSidebarSnapshot();
    const staleBlock = snapshot.staleFiles.find(file => file.filePath === repairPath)?.children[0]?.children[0];
    assert.ok(staleBlock, '定義行シフトで直らない stale block が queue に出るべき');

    await vscode.commands.executeCommand('codeWalker.sidebar.repairNode', staleBlock);
    await sleep(150);

    await exports.testHooks.refreshSidebar();
    snapshot = await exports.testHooks.getSidebarSnapshot();
    assert.ok(
      !snapshot.staleFiles.some(file => file.filePath === repairPath),
      'repair 後は stale queue から対象 block が消えるべき',
    );

    const manualFile = await exports.cacheService.readFile('walks-manual', repairPath) as {
      symbols?: Record<string, {
        blocks: Array<{
          startLine: number;
          endLine: number;
          annotations?: Array<{ line: number; text: string }>;
        }>;
      }>;
    } | null;
    const repairedBlock = manualFile?.symbols?.drifted?.blocks?.[0];
    assert.ok(repairedBlock, 'repair 後の block がキャッシュに残るべき');
    assert.strictEqual(repairedBlock!.startLine, 4, '開始行は symbol 内の hash 一致位置へ再配置されるべき');
    assert.strictEqual(repairedBlock!.endLine, 4, '終了行も再配置先に更新されるべき');
    assert.deepStrictEqual(
      repairedBlock!.annotations,
      [{ line: 4, text: 'return statement' }],
      'annotations も block と同じ delta で再配置されるべき',
    );

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'workspace folder があるべき');
    const uri = vscode.Uri.joinPath(workspaceFolder!.uri, repairPath);
    const details = exports.blockStore.getBlockDetails(uri, 'drifted');
    assert.ok(details, 'repair 後は BlockStore に再ロードされるべき');
    assert.strictEqual(details?.[0].block.startLine, 4);
    assert.strictEqual(details?.[0].block.endLine, 4);
    assert.strictEqual(details?.[0].hashMismatch, undefined, 'repair 後は stale フラグが消えるべき');
  });

  test('UC6.13: Sidebar の repair コマンドは曖昧な hash 一致候補を preview して選択適用できる', async () => {
    const repairPath = 'tmp-sidebar/repair_preview.ts';

    writeWorkspaceFile(repairPath, [
      'export function ambiguous(flag: boolean) {',
      '  console.log(value);',
      '  return flag;',
      '}',
      '',
    ].join('\n'));
    const signatureHash = await computeBlockHashForFixture(repairPath, 1, 1);
    const originalHash = await computeBlockHashForFixture(repairPath, 2, 2);
    await closeAllEditors();

    await exports.cacheService.writeFile('walks-manual', repairPath, {
      version: '1.0',
      filePath: repairPath,
      symbols: {
        ambiguous: {
          symbolName: 'ambiguous',
          overview: 'manual ambiguous',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [
            {
              label: 'Signature',
              startLine: 1,
              endLine: 1,
              colorIndex: 0,
              blockHash: signatureHash,
            },
            {
              label: 'Duplicate Line',
              startLine: 2,
              endLine: 2,
              colorIndex: 1,
              explanation: 'pick one',
              annotations: [{ line: 2, text: 'duplicate line' }],
              blockHash: originalHash,
            },
          ],
        },
      },
    });

    writeWorkspaceFile(repairPath, [
      'export function ambiguous(flag: boolean) {',
      '  const spacer = flag ? 1 : 0;',
      '  console.log(value);',
      '',
      '  if (spacer > 0) {',
      '    return true;',
      '  }',
      '',
      '  console.log(value);',
      '  return false;',
      '}',
      '',
    ].join('\n'));

    await openFile(repairPath);
    await sleep(200);

    await exports.testHooks.refreshSidebar();
    let snapshot = await exports.testHooks.getSidebarSnapshot();
    const staleBlock = snapshot.staleFiles
      .find(file => file.filePath === repairPath)
      ?.children[0]
      ?.children.find(block => block.stale);
    assert.ok(staleBlock, '曖昧一致の stale block が queue に出るべき');

    await vscode.commands.executeCommand('codeWalker.sidebar.repairNode', staleBlock);
    await sleep(150);

    const preview = exports.testHooks.getCurrentRepairPreviewData();
    assert.ok(preview, '曖昧一致時は repair preview が開くべき');
    assert.strictEqual(preview!.symbolName, 'ambiguous');
    assert.strictEqual(preview!.blockIndex, 1);
    assert.strictEqual(preview!.oldStartLine, 2);
    assert.strictEqual(preview!.codeStartLine, 1);
    assert.strictEqual(preview!.candidates.length, 2, '重複 hash 候補が 2 件並ぶべき');
    assert.deepStrictEqual(
      preview!.candidates.map(candidate => [candidate.startLine, candidate.endLine, candidate.canApply]),
      [[3, 3, true], [9, 9, true]],
      'preview は両方の一致候補を適用可能として提示するべき',
    );
    assert.strictEqual(exports.testHooks.getCurrentEditInitData(), undefined, 'preview がある場合は edit/import に即フォールバックしないべき');

    const selectedCandidate = preview!.candidates.find(candidate => candidate.startLine === 9 && candidate.endLine === 9);
    assert.ok(selectedCandidate, '後半ブロックの候補があるべき');

    await exports.testHooks.applyRepairPreviewCandidateForTest(selectedCandidate!.id);
    await sleep(150);

    assert.strictEqual(exports.testHooks.getCurrentRepairPreviewData(), undefined, '候補適用後は preview が閉じるべき');

    await exports.testHooks.refreshSidebar();
    snapshot = await exports.testHooks.getSidebarSnapshot();
    assert.ok(
      !snapshot.staleFiles.some(file => file.filePath === repairPath),
      'preview 適用後は stale queue から対象 block が消えるべき',
    );

    const manualFile = await exports.cacheService.readFile('walks-manual', repairPath) as {
      symbols?: Record<string, {
        blocks: Array<{
          startLine: number;
          endLine: number;
          explanation?: string;
          annotations?: Array<{ line: number; text: string }>;
        }>;
      }>;
    } | null;
    const repairedBlock = manualFile?.symbols?.ambiguous?.blocks?.[1];
    assert.ok(repairedBlock, 'preview 適用後の block がキャッシュに残るべき');
    assert.strictEqual(repairedBlock!.startLine, 9);
    assert.strictEqual(repairedBlock!.endLine, 9);
    assert.strictEqual(repairedBlock!.explanation, 'pick one', 'explanation は保持されるべき');
    assert.deepStrictEqual(
      repairedBlock!.annotations,
      [{ line: 9, text: 'duplicate line' }],
      'annotations も選択した候補へ追従するべき',
    );
  });
});

async function computeBlockHashForFixture(filePath: string, startLine: number, endLine: number): Promise<string> {
  const editor = await openFile(filePath);
  const lines: string[] = [];
  for (let lineNumber = startLine - 1; lineNumber <= endLine - 1; lineNumber++) {
    lines.push(editor.document.lineAt(lineNumber).text);
  }
  const hash = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  return `sha256:${hash}`;
}

async function writeTargetsFile(data: {
  version: string;
  createdAt: string;
  config: { path: string; level: string; extensions: string[] };
  targets: Array<{ filePath: string; symbolName: string; kind: string; line: number; status: 'pending' | 'done' | 'skip' }>;
  skipped: unknown[];
  summary: Record<string, unknown>;
}): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }

  const codeWalkerDir = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker');
  await vscode.workspace.fs.createDirectory(codeWalkerDir);
  const fileUri = vscode.Uri.joinPath(codeWalkerDir, 'targets.json');
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
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

function cleanupSidebarTempFiles(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  fs.rmSync(path.join(workspaceFolder.uri.fsPath, 'tmp-sidebar'), { recursive: true, force: true });
}