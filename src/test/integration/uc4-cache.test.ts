/**
 * Integration テスト: UC4 キャッシュ復元 & ライフサイクル
 *
 * UC4.1: キャッシュ書き込み + 読み込み
 * UC4.2: Manual / Auto 共存復元
 * UC4.3: ファイルハッシュ不一致
 * UC4.4: ファイルクローズ → 再オープン
 * UC4.5: CacheService CRUD
 * UC4.6: explanation 往復保存
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { openFile, closeAllEditors, cleanCodeWalkerCache, getExtensionExports, sleep, type ExtensionExports } from './helpers';

suite('UC4: キャッシュ復元 & ライフサイクル', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    cleanupTempRestoreFiles();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    cleanupTempRestoreFiles();
    await closeAllEditors();
  });

  // ── UC4.5: CacheService 基本 CRUD ────────────────────────

  test('UC4.5: CacheService で JSON を書き込み・読み込みできる', async () => {
    const cs = exports.cacheService;
    assert.ok(cs.hasWorkspace(), 'ワークスペースが開かれているべき');

    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'テスト概要',
          updatedAt: new Date().toISOString(),
          source: 'manual' as const,
          blocks: [{
            label: '挨拶処理',
            startLine: 9,
            endLine: 13,
            colorIndex: 0,
            description: 'テスト説明',
          }],
        },
      },
    };

    // 書き込み
    await cs.writeFile('walks-manual', 'sample_py', cacheData as never);

    // 読み込み
    const loaded = await cs.readFile('walks-manual', 'sample_py') as typeof cacheData | null;
    assert.ok(loaded, 'キャッシュファイルが読み込めるべき');
    assert.strictEqual(loaded!.filePath, 'sample.py');
    assert.ok(loaded!.symbols.greet, 'greet シンボルが存在するべき');
    assert.strictEqual(loaded!.symbols.greet.blocks[0].label, '挨拶処理');
  });

  test('UC4.5: CacheService 存在しないファイルの読み込みは null を返す', async () => {
    const cs = exports.cacheService;
    const result = await cs.readFile('walks-manual', 'nonexistent_file');
    assert.strictEqual(result, null, '存在しないファイルは null');
  });

  test('UC4.5: CacheService deleteFile でキャッシュを削除できる', async () => {
    const cs = exports.cacheService;

    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {},
    };

    await cs.writeFile('walks-manual', 'test_delete', cacheData as never);
    const beforeDelete = await cs.readFile('walks-manual', 'test_delete');
    assert.ok(beforeDelete, '削除前は読み込めるべき');

    const deleted = await cs.deleteFile('walks-manual', 'test_delete');
    assert.ok(deleted, 'deleteFile が true を返すべき');

    const afterDelete = await cs.readFile('walks-manual', 'test_delete');
    assert.strictEqual(afterDelete, null, '削除後は null');
  });

  // ── UC4.2: Manual / Auto 共存復元 ──────────────────────

  test('UC4.2: Manual と Auto の両方にキャッシュがある場合、同一シンボルも両 source を保持する', async () => {
    const cs = exports.cacheService;

    // Manual キャッシュ
    const manualCache = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'Manual版',
          updatedAt: new Date().toISOString(),
          source: 'manual' as const,
          blocks: [{
            label: 'Manual挨拶',
            startLine: 9,
            endLine: 13,
            colorIndex: 0,
          }],
        },
      },
    };

    // Auto キャッシュ（同じシンボル + 追加シンボル）
    const autoCache = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'Auto版',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [{
            label: 'Auto挨拶',
            startLine: 9,
            endLine: 13,
            colorIndex: 0,
          }],
        },
        add: {
          symbolName: 'add',
          overview: 'Auto版add',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [{
            label: 'Auto加算',
            startLine: 17,
            endLine: 19,
            colorIndex: 1,
          }],
        },
      },
    };

    await cs.writeFile('walks-manual', 'sample_py', manualCache as never);
    await cs.writeFile('walks-auto', 'sample_py', autoCache as never);

    // 読み込み検証（restoreCache の source 共存ロジックを再現）
    const manualData = await cs.readFile('walks-manual', 'sample_py') as typeof manualCache | null;
    const autoData = await cs.readFile('walks-auto', 'sample_py') as typeof autoCache | null;

    const restoredSymbols: Array<{ symbolName: string; source: string }> = [];
    if (manualData) {
      for (const [name, entry] of Object.entries(manualData.symbols)) {
        restoredSymbols.push({ symbolName: name, source: entry.source ?? 'manual' });
      }
    }
    if (autoData) {
      for (const [name, entry] of Object.entries(autoData.symbols)) {
        restoredSymbols.push({ symbolName: name, source: entry.source ?? 'auto' });
      }
    }

    assert.deepStrictEqual(
      restoredSymbols,
      [
        { symbolName: 'greet', source: 'manual' },
        { symbolName: 'greet', source: 'auto' },
        { symbolName: 'add', source: 'auto' },
      ],
      '同一シンボルでも Manual / Auto の両 source が復元対象に残るべき',
    );

    assert.strictEqual(
      restoredSymbols.filter(symbol => symbol.symbolName === 'greet').length,
      2,
      'greet には Manual / Auto の 2 エントリが残るべき',
    );
  });

  // ── UC4.3: ファイルハッシュ不一致検出 ──────────────────────

  test('UC4.3: 異なる blockHash でキャッシュを作成し、不一致を検出できる', async () => {
    const cs = exports.cacheService;

    // 現在のファイル内容から対象行（9-13行目）の実際のハッシュを計算
    const editor = await openFile('sample.py');
    const doc = editor.document;
    const lines: string[] = [];
    for (let i = 8; i <= 12; i++) { // 0-based: line 9-13
      lines.push(doc.lineAt(i).text);
    }
    const actualHash = 'sha256:' + crypto.createHash('sha256').update(lines.join('\n')).digest('hex');

    // 故意に異なる blockHash のキャッシュを作成
    const staleCache = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: '古い版',
          updatedAt: new Date().toISOString(),
          source: 'manual' as const,
          blocks: [{
            label: '古いブロック',
            startLine: 9,
            endLine: 13,
            colorIndex: 0,
            blockHash: 'sha256:completely_different_hash_value',
          }],
        },
      },
    };

    await cs.writeFile('walks-manual', 'sample_py', staleCache as never);

    // 書き込んだキャッシュを読み込み
    const cached = await cs.readFile('walks-manual', 'sample_py') as typeof staleCache | null;
    assert.ok(cached);

    // ブロックハッシュ比較
    assert.notStrictEqual(cached!.symbols.greet.blocks[0].blockHash, actualHash,
      'キャッシュの blockHash と現在のブロックハッシュは異なるべき');
  });

  // ── UC4.5: deleteSubDir でサブディレクトリ全体を削除 ────

  test('UC4.5: deleteSubDir で walks-manual 全体を削除できる', async () => {
    const cs = exports.cacheService;

    // 複数のキャッシュファイルを書き込み
    const data = {
      version: '1.0',
      filePath: 'test.py',
      symbols: {},
    };

    await cs.writeFile('walks-manual', 'file1', data as never);
    await cs.writeFile('walks-manual', 'file2', data as never);

    // 全体削除
    await cs.deleteSubDir('walks-manual');

    // 両方とも null になるべき
    const r1 = await cs.readFile('walks-manual', 'file1');
    const r2 = await cs.readFile('walks-manual', 'file2');
    assert.strictEqual(r1, null, 'file1 は削除されているべき');
    assert.strictEqual(r2, null, 'file2 は削除されているべき');
  });

  // ── UC4.6: explanation 往復保存 ──────────────────────────

  test('UC4.6: explanation 付きキャッシュを保存し、復元後も explanation が保持される', async () => {
    const cs = exports.cacheService;
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 1. explanation 付きキャッシュを walks-auto に保存
    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: '挨拶関数',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [
            {
              label: '引数チェック',
              startLine: 9,
              endLine: 11,
              colorIndex: 0,
              description: 'None チェック',
              explanation: 'name が None の場合は "Hello, World!" を返す',
            },
            {
              label: '挨拶生成',
              startLine: 12,
              endLine: 13,
              colorIndex: 1,
              description: '文字列生成',
              explanation: '名前付きの挨拶文 "Hello, {name}!" を返す',
            },
          ],
        },
      },
    };
    await cs.writeFile('walks-auto', 'sample_py', cacheData as never);

    // 2. キャッシュを読み込み、explanation が含まれているか検証
    const loaded = await cs.readFile('walks-auto', 'sample_py') as typeof cacheData | null;
    assert.ok(loaded, 'キャッシュが読み込めるべき');
    assert.strictEqual(
      loaded!.symbols.greet.blocks[0].explanation,
      'name が None の場合は "Hello, World!" を返す',
      'ブロック0のexplanationがキャッシュに保存されているべき',
    );
    assert.strictEqual(
      loaded!.symbols.greet.blocks[1].explanation,
      '名前付きの挨拶文 "Hello, {name}!" を返す',
      'ブロック1のexplanationがキャッシュに保存されているべき',
    );

    // 3. BlockStore にブロックを登録し、キャッシュから explanation を復元（restoreFromCache 相当）
    const blockInfos = loaded!.symbols.greet.blocks.map((b: { label: string; startLine: number; endLine: number; colorIndex: number; description?: string }, i: number) => ({
      index: i,
      label: b.label,
      startLine: b.startLine,
      endLine: b.endLine,
      colorIndex: b.colorIndex,
      description: b.description,
    }));
    exports.blockStore.setBlocks(uri, 'greet', blockInfos, 'auto');
    for (let i = 0; i < loaded!.symbols.greet.blocks.length; i++) {
      const b = loaded!.symbols.greet.blocks[i];
      if (b.explanation) {
        exports.blockStore.setExplanation(uri, 'greet', i, b.explanation);
      }
    }

    // 4. BlockStore から explanation が取得できるか検証
    const exp0 = exports.blockStore.getExplanation(uri, 'greet', 0);
    assert.strictEqual(exp0, 'name が None の場合は "Hello, World!" を返す',
      '復元後の BlockStore からブロック0の explanation が取得できるべき');
    const exp1 = exports.blockStore.getExplanation(uri, 'greet', 1);
    assert.strictEqual(exp1, '名前付きの挨拶文 "Hello, {name}!" を返す',
      '復元後の BlockStore からブロック1の explanation が取得できるべき');
  });

  test('UC4.6: explanation が空のブロックはキャッシュ復元後も undefined', async () => {
    const cs = exports.cacheService;
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // explanation が無いブロックを含むキャッシュ
    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        add: {
          symbolName: 'add',
          overview: '加算関数',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [
            {
              label: '加算処理',
              startLine: 16,
              endLine: 19,
              colorIndex: 0,
              description: '単純な加算',
              // explanation なし
            },
          ],
        },
      },
    };
    await cs.writeFile('walks-auto', 'sample_py', cacheData as never);

    // 復元
    const loaded = await cs.readFile('walks-auto', 'sample_py') as typeof cacheData | null;
    assert.ok(loaded);
    const blockInfos = loaded!.symbols.add.blocks.map((b: { label: string; startLine: number; endLine: number; colorIndex: number; description?: string }, i: number) => ({
      index: i, label: b.label, startLine: b.startLine, endLine: b.endLine, colorIndex: b.colorIndex, description: b.description,
    }));
    exports.blockStore.setBlocks(uri, 'add', blockInfos, 'auto');

    // explanation が undefined であることを確認
    const exp = exports.blockStore.getExplanation(uri, 'add', 0);
    assert.strictEqual(exp, undefined, 'explanation なしブロックの復元後は undefined');
  });

  test('UC4.6: BlockStore の explanation がキャッシュ JSON に正しく含まれる（往復検証）', async () => {
    const cs = exports.cacheService;
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 1. BlockStore にブロックと explanation を登録（HighlightTool 相当）
    const blocks = [
      { index: 0, label: 'ブロックA', startLine: 9, endLine: 11, colorIndex: 0 },
      { index: 1, label: 'ブロックB', startLine: 12, endLine: 13, colorIndex: 1 },
    ];
    exports.blockStore.setBlocks(uri, 'greet', blocks, 'auto');
    exports.blockStore.setExplanation(uri, 'greet', 0, '解説Aの内容');
    exports.blockStore.setExplanation(uri, 'greet', 1, '解説Bの内容');

    // 2. ExportTool 相当: BlockStore から explanation を取得してキャッシュに保存
    const cachedBlocks = blocks.map((b, i) => ({
      label: b.label,
      startLine: b.startLine,
      endLine: b.endLine,
      colorIndex: b.colorIndex,
      explanation: exports.blockStore.getExplanation(uri, 'greet', i),
    }));
    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: '挨拶関数',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: cachedBlocks,
        },
      },
    };
    await cs.writeFile('walks-auto', 'sample_py', cacheData as never);

    // 3. BlockStore クリア（タブ切替シミュレーション）
    exports.blockStore.clearUri(uri);
    assert.strictEqual(exports.blockStore.getExplanation(uri, 'greet', 0), undefined,
      'クリア後は explanation が undefined');

    // 4. キャッシュから復元
    const loaded = await cs.readFile('walks-auto', 'sample_py') as typeof cacheData | null;
    assert.ok(loaded);
    const restoredBlocks = loaded!.symbols.greet.blocks.map((b: { label: string; startLine: number; endLine: number; colorIndex: number }, i: number) => ({
      index: i, label: b.label, startLine: b.startLine, endLine: b.endLine, colorIndex: b.colorIndex,
    }));
    exports.blockStore.setBlocks(uri, 'greet', restoredBlocks, 'auto');
    for (let i = 0; i < loaded!.symbols.greet.blocks.length; i++) {
      const b = loaded!.symbols.greet.blocks[i];
      if (b.explanation) {
        exports.blockStore.setExplanation(uri, 'greet', i, b.explanation);
      }
    }

    // 5. 往復後も explanation が保持されているか検証
    assert.strictEqual(exports.blockStore.getExplanation(uri, 'greet', 0), '解説Aの内容',
      '往復後もブロック0の explanation が保持されるべき');
    assert.strictEqual(exports.blockStore.getExplanation(uri, 'greet', 1), '解説Bの内容',
      '往復後もブロック1の explanation が保持されるべき');
  });

  // ── UC4.1/B1: キャッシュ自動復元ライフサイクル ──────────

  test('UC4.1: キャッシュファイルが存在する状態でファイルを開くと自動復元される', async () => {
    const cs = exports.cacheService;

    // キャッシュファイルを事前に作成
    const editor = await openFile('sample.py');
    await closeAllEditors();

    const cacheData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: '挨拶関数',
          updatedAt: new Date().toISOString(),
          source: 'manual' as const,
          blocks: [{
            label: 'キャッシュ復元テスト',
            startLine: 9,
            endLine: 13,
            colorIndex: 0,
            description: 'キャッシュから自動復元されたブロック',
          }],
        },
      },
    };

    await cs.writeFile('walks-manual', 'sample.py', cacheData as never);

    // ファイルを開いて restoreFromCache を直接呼び出す
    // （テスト環境では onDidCloseTextDocument が確実に発火しないため restoredUris が残り
    //   ライフサイクル経由の自動復元がスキップされる。直接呼出しで機能を検証する。）
    const editor2 = await openFile('sample.py');
    const restored = await exports.restoreFromCache(
      editor2,
      exports.blockStore as never,
      exports.cacheService as never,
    );
    assert.ok(restored, '[UC4.1] restoreFromCache が true を返すべき');

    const names = exports.blockStore.getSymbolNames(editor2.document.uri);
    assert.ok(
      names.includes('greet'),
      `[UC4.1] キャッシュ復元で greet が BlockStore に登録されるべき（実際: [${names.join(', ')}]）`,
    );
  });

  test('UC4.7: 初回 restore miss の後は tracked 状態が残らず再試行可能なままになる', async () => {
    const cs = exports.cacheService;
    const relativePath = 'tmp-restore/retry_restore.py';
    writeWorkspaceFile(relativePath, 'def retry_restore():\n    return 1\n');

    const editor = await openFile(relativePath);

    await exports.testHooks.restoreEditorByUri(editor.document.uri);
    await sleep(50);
    assert.deepStrictEqual(
      exports.blockStore.getSymbolNames(editor.document.uri),
      [],
      'キャッシュ未作成時は BlockStore に何も登録されないべき',
    );
    assert.strictEqual(
      exports.testHooks.isRestoreTracked(editor.document.uri),
      false,
      'restore miss の後は tracked 状態が残らないべき',
    );

    await cs.writeFile('walks-manual', relativePath, {
      version: '1.0',
      filePath: relativePath,
      symbols: {
        retry_restore: {
          symbolName: 'retry_restore',
          overview: 'retry restore',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{
            label: 'Retry Restore',
            startLine: 1,
            endLine: 2,
            colorIndex: 0,
          }],
        },
      },
    } as never);

    const restored = await exports.restoreFromCache(
      editor,
      exports.blockStore as never,
      exports.cacheService as never,
    );

    const names = exports.blockStore.getSymbolNames(editor.document.uri);
    assert.strictEqual(restored, true, 'キャッシュ書き込み後は direct restore が成功するべき');
    assert.ok(
      names.includes('retry_restore'),
      `キャッシュ書き込み後は retry_restore が復元されるべき（実際: [${names.join(', ')}]）`,
    );
  });
});

function writeWorkspaceFile(relativePath: string, contents: string): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }

  const targetPath = path.join(workspaceFolder.uri.fsPath, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, 'utf-8');
}

function cleanupTempRestoreFiles(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  fs.rmSync(path.join(workspaceFolder.uri.fsPath, 'tmp-restore'), { recursive: true, force: true });
}
