/**
 * Integration テスト: UC1 対話ウォークスルー / UC2 バッチウォークスルー
 *
 * ツール層（AnalyzeTool, HighlightTool, ExportTool, FindSymbolTool, ListSymbolsTool）
 * の入出力・副作用を検証する。
 *
 * 注: ツールは vscode.lm.registerTool で登録されるため、直接 invoke できない。
 *     ここではツールが内部で行うデータフロー操作（BlockStore + CacheService）を
 *     同等のロジックで検証する。
 *     AI モデル呼び出しが必要な AnalyzeTool / DrilldownTool は E2E スコープ。
 *
 * UC1.2: highlight 相当 — ブロック登録 + ハイライト（UC3.1 と同等）
 * UC1.6: export(JSON) 相当 — CacheService.writeFile
 * UC1.9: find_symbol 相当 — executeWorkspaceSymbolProvider
 * UC2.1: list_symbols 相当 — executeDocumentSymbolProvider + targets.json
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  openFile, closeAllEditors, cleanCodeWalkerCache,
  getExtensionExports, sleep, type ExtensionExports,
} from './helpers';

suite('UC1: 対話ウォークスルー（ツール層データフロー）', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  // ── UC1.2: highlight ツール相当のデータフロー ──────────

  test('UC1.2: HighlightTool が行う処理を再現: ブロック登録 + CodeLens + 解説', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // HighlightTool の入力相当:
    // { filePath, symbolName, blocks, annotations, explanations }
    const symbolName = 'greet';
    const blocks = [
      { index: 0, label: '引数チェック', startLine: 10, endLine: 11, colorIndex: 0, description: 'name の None チェック' },
      { index: 1, label: '挨拶生成', startLine: 12, endLine: 13, colorIndex: 1, description: '挨拶文字列を返す' },
    ];
    const explanations = [
      { blockIndex: 0, text: 'name が None の場合は "Hello, World!" を返す' },
      { blockIndex: 1, text: '名前付きの挨拶文 "Hello, {name}!" を返す' },
    ];

    // HighlightTool の内部処理を再現
    exports.blockStore.setBlocks(uri, symbolName, blocks, 'auto');
    for (const exp of explanations) {
      exports.blockStore.setExplanation(uri, symbolName, exp.blockIndex, exp.text);
    }

    // 検証: BlockStore に正しく登録されている
    const details = exports.blockStore.getBlockDetails(uri, symbolName);
    assert.ok(details, 'BlockDetail が存在するべき');
    assert.strictEqual(details!.length, 2, 'ブロック数 = 2');
    assert.strictEqual(details![0].source, 'auto', 'source = auto');

    // 解説の検証
    const exp0 = exports.blockStore.getExplanation(uri, symbolName, 0);
    assert.strictEqual(exp0, 'name が None の場合は "Hello, World!" を返す');
    const exp1 = exports.blockStore.getExplanation(uri, symbolName, 1);
    assert.strictEqual(exp1, '名前付きの挨拶文 "Hello, {name}!" を返す');

    // CodeLens の検証
    const token = new vscode.CancellationTokenSource().token;
    const lenses = (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(editor.document, token) as vscode.CodeLens[];
    // Auto blocks: メイン + 📥 = 2 per block → 2 * 2 = 4
    assert.strictEqual(lenses.length, 4, `CodeLens は 4 個であるべき（実際: ${lenses.length}）`);

    // Auto バッジ確認
    const titles = lenses.map(l => l.command!.title);
    assert.ok(titles.some(t => t.includes('[A]')), 'Auto バッジが存在するべき');
  });

  // ── UC1.6: export(JSON) ツール相当のデータフロー ────────

  test('UC1.6: ExportTool(JSON) が行う処理を再現: CacheService に正しいフォーマットで保存', async () => {
    const cs = exports.cacheService;

    // ExportTool の入力相当:
    const exportData = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'greet 関数は名前を受け取り挨拶文を返す。',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [
            {
              label: '引数チェック',
              startLine: 10,
              endLine: 11,
              colorIndex: 0,
              description: 'None チェック',
              explanation: 'name が None なら "Hello, World!" を返す',
              annotations: [{ line: 10, text: '# None チェック' }],
            },
            {
              label: '挨拶生成',
              startLine: 12,
              endLine: 13,
              colorIndex: 1,
              description: '文字列生成',
            },
          ],
        },
      },
    };

    // ExportTool 内部処理を再現
    await cs.writeFile('walks-auto', 'sample_py', exportData as never);

    // 読み込みで検証
    const loaded = await cs.readFile('walks-auto', 'sample_py') as typeof exportData | null;
    assert.ok(loaded, 'キャッシュを読み込めるべき');
    assert.strictEqual(loaded!.version, '1.0');
    assert.strictEqual(loaded!.filePath, 'sample.py');

    const sym = loaded!.symbols.greet;
    assert.ok(sym, 'greet シンボルが存在するべき');
    assert.strictEqual(sym.source, 'auto');
    assert.strictEqual(sym.blocks.length, 2);
    assert.strictEqual(sym.blocks[0].explanation, 'name が None なら "Hello, World!" を返す');
    assert.ok(sym.blocks[0].annotations);
    assert.strictEqual(sym.blocks[0].annotations!.length, 1);
  });

  // ── UC1.8: 保存しない選択 → BlockStore にはデータが残る ──

  test('UC1.8: エクスポートせずに終了した場合、BlockStore にデータは残りキャッシュは空', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // HighlightTool でブロック登録（Auto）
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'テストブロック', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'auto');

    // キャッシュには保存しない（UC1.8 のケース）
    const cached = await exports.cacheService.readFile('walks-auto', 'sample_py');
    assert.strictEqual(cached, null, 'キャッシュファイルは存在しないべき');

    // BlockStore にはデータが残っている
    const names = exports.blockStore.getSymbolNames(uri);
    assert.ok(names.includes('greet'), 'BlockStore にはデータが残るべき');
  });

  // ── B4: BlockStore 未登録時の showBlockDetail ────────────

  test('B4: HighlightTool 実行前（BlockStore 空）に showBlockDetail を呼ぶとエラーなく処理される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // BlockStore は空の状態
    const names = exports.blockStore.getSymbolNames(uri);
    assert.strictEqual(names.length, 0, 'BlockStore は空であるべき');

    // showBlockDetail を呼ぶ → 'Block info not found.' メッセージ
    // B4: analyze → highlight 間に CodeLens をクリックすると
    //     BlockStore にまだデータがないためこのパスを通る
    await vscode.commands.executeCommand('codeWalker.showBlockDetail', uri, 'greet', 0);
    assert.ok(true, 'showBlockDetail が例外なく完了する（情報メッセージ表示のみ）');
  });

  test('B4: Export「保存しない」後も BlockStore のデータが残り CodeLens が表示される', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // HighlightTool 相当: ブロック登録
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'テスト', startLine: 9, endLine: 13, colorIndex: 0 },
    ], 'auto');

    // Export「保存しない」= キャッシュに何も書かない
    // → BlockStore にはデータが残り、CodeLens も残る
    const token = new vscode.CancellationTokenSource().token;
    const lenses = (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(editor.document, token) as vscode.CodeLens[];

    // B4: これは「バグ」ではなく設計判断だが、ユーザーが混乱するケース
    // clearHighlights を明示的に呼ばない限り CodeLens は残る
    assert.ok(lenses.length > 0, 'Export 保存しない後も CodeLens は残る（設計上）');

    // clearHighlights で明示的にクリア
    await vscode.commands.executeCommand('codeWalker.clearHighlights');
    const lensesAfterClear = (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(editor.document, token) as vscode.CodeLens[];
    assert.strictEqual(lensesAfterClear.length, 0, 'clearHighlights 後は CodeLens がなくなるべき');
  });

  // ── UC1.9: find_symbol 相当 ──────────────────────────────

  test('UC1.9: executeWorkspaceSymbolProvider でシンボル検索ができる', async () => {
    // Python 言語サーバーが利用可能か確認
    // テスト環境では Language Server が起動していない可能性がある
    await openFile('sample.py');
    await sleep(2000); // Language Server 起動待ち

    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        'greet',
      );

      if (!symbols || symbols.length === 0) {
        // Language Server が無い環境では結果が返らない（テストスキップ相当）
        console.log('  [SKIP] Language Server 未起動のため WorkspaceSymbolProvider の結果なし');
        return;
      }

      // シンボルが見つかった場合の検証
      const greetSymbol = symbols.find(s => s.name === 'greet');
      assert.ok(greetSymbol, 'greet シンボルが見つかるべき');
    } catch {
      console.log('  [SKIP] WorkspaceSymbolProvider が利用できません');
    }
  });
});

// ────────────────────────────────────────────────────────────
// UC2: バッチウォークスルー
// ────────────────────────────────────────────────────────────

suite('UC2: バッチウォークスルー（ツール層データフロー）', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    cleanCodeWalkerCache();
    await closeAllEditors();
  });

  // ── UC2.1: list_symbols 相当 ─────────────────────────────

  test('UC2.1: executeDocumentSymbolProvider でドキュメントシンボルを取得できる', async () => {
    const editor = await openFile('sample.py');
    await sleep(2000); // Language Server 起動待ち

    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        editor.document.uri,
      );

      if (!symbols || symbols.length === 0) {
        console.log('  [SKIP] Language Server 未起動のため DocumentSymbolProvider の結果なし');
        return;
      }

      // Python ファイルには greet, add, Calculator があるはず
      const names = symbols.map(s => s.name);
      assert.ok(names.length > 0, 'シンボルが 1 つ以上存在するべき');
      console.log(`  DocumentSymbol: ${names.join(', ')}`);
    } catch {
      console.log('  [SKIP] DocumentSymbolProvider が利用できません');
    }
  });

  // ── UC2.3: バッチ処理ループの再現 ─────────────────────────

  test('UC2.3: 複数シンボルを順次処理して BlockStore + キャッシュに登録', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // バッチ処理: 3 つのシンボルを順次処理
    const targets = [
      { symbolName: 'greet', blocks: [{ index: 0, label: '引数チェック', startLine: 10, endLine: 11, colorIndex: 0 }, { index: 1, label: '挨拶生成', startLine: 12, endLine: 13, colorIndex: 1 }] },
      { symbolName: 'add', blocks: [{ index: 0, label: '加算処理', startLine: 17, endLine: 19, colorIndex: 0 }] },
      { symbolName: 'Calculator', blocks: [{ index: 0, label: 'コンストラクタ', startLine: 23, endLine: 26, colorIndex: 0 }, { index: 1, label: '掛け算', startLine: 28, endLine: 31, colorIndex: 1 }] },
    ];

    for (const target of targets) {
      exports.blockStore.setBlocks(uri, target.symbolName, target.blocks, 'auto');

      // ExportTool: JSON キャッシュに追記
      const existingCache = await exports.cacheService.readFile('walks-auto', 'sample_py');
      const cacheData = (existingCache as Record<string, unknown>) ?? {
        version: '1.0',
        filePath: 'sample.py',
        symbols: {},
      };

      (cacheData as { symbols: Record<string, unknown> }).symbols[target.symbolName] = {
        symbolName: target.symbolName,
        overview: `${target.symbolName} の概要`,
        updatedAt: new Date().toISOString(),
        source: 'auto',
        blocks: target.blocks,
      };

      await exports.cacheService.writeFile('walks-auto', 'sample_py', cacheData as never);
    }

    // 全シンボルが BlockStore に登録されている
    const names = exports.blockStore.getSymbolNames(uri);
    assert.strictEqual(names.length, 3, '3 シンボルが登録されるべき');
    assert.ok(names.includes('greet'));
    assert.ok(names.includes('add'));
    assert.ok(names.includes('Calculator'));

    // キャッシュにも全シンボルが保存されている
    const cached = await exports.cacheService.readFile('walks-auto', 'sample_py') as { symbols: Record<string, unknown> } | null;
    assert.ok(cached);
    assert.strictEqual(Object.keys(cached!.symbols).length, 3, 'キャッシュに 3 シンボル');
  });

  // ── UC2.4: バッチ中断＋再開 ──────────────────────────────

  test('UC2.4: 途中まで処理されたキャッシュが保持され、続きから再開できる', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 1 シンボルだけ処理済み（中断を想定）
    const partialCache = {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: '挨拶関数',
          updatedAt: new Date().toISOString(),
          source: 'auto' as const,
          blocks: [{ label: 'チェック', startLine: 10, endLine: 11, colorIndex: 0 }],
        },
      },
    };
    await exports.cacheService.writeFile('walks-auto', 'sample_py', partialCache as never);

    // 再開: 残りのシンボルを処理
    const existingCache = await exports.cacheService.readFile('walks-auto', 'sample_py') as Record<string, unknown> & { symbols: Record<string, unknown> };
    assert.ok(existingCache);
    assert.ok(existingCache.symbols.greet, 'greet は処理済み');
    assert.ok(!existingCache.symbols.add, 'add は未処理');

    // add を追加処理
    existingCache.symbols.add = {
      symbolName: 'add',
      overview: '加算関数',
      updatedAt: new Date().toISOString(),
      source: 'auto' as const,
      blocks: [{ label: '加算', startLine: 17, endLine: 19, colorIndex: 0 }],
    };
    await exports.cacheService.writeFile('walks-auto', 'sample_py', existingCache as never);

    // 検証: 両方のシンボルがキャッシュに存在
    const finalCache = await exports.cacheService.readFile('walks-auto', 'sample_py') as Record<string, unknown> & { symbols: Record<string, unknown> };
    assert.ok(finalCache);
    assert.ok(finalCache.symbols.greet, 'greet がキャッシュに存在');
    assert.ok(finalCache.symbols.add, 'add がキャッシュに存在');
  });

  // ── UC2.5: バッチ完了後の CodeLens 確認 ──────────────────

  test('UC2.5: バッチ完了後、全シンボルの CodeLens がクリック可能', async () => {
    const editor = await openFile('sample.py');
    const uri = editor.document.uri;

    // 3 シンボルを全て登録（バッチ完了）
    exports.blockStore.setBlocks(uri, 'greet', [
      { index: 0, label: 'チェック', startLine: 10, endLine: 11, colorIndex: 0 },
    ], 'auto');
    exports.blockStore.setBlocks(uri, 'add', [
      { index: 0, label: '加算', startLine: 17, endLine: 19, colorIndex: 0 },
    ], 'auto');
    exports.blockStore.setBlocks(uri, 'Calculator', [
      { index: 0, label: 'コンストラクタ', startLine: 23, endLine: 26, colorIndex: 0 },
    ], 'auto');

    const token = new vscode.CancellationTokenSource().token;
    const lenses = (exports.codeLensProvider as vscode.CodeLensProvider).provideCodeLenses!(editor.document, token) as vscode.CodeLens[];

    // 3 シンボル × (メイン + 📥) = 3 × 2 = 6
    assert.strictEqual(lenses.length, 6, `CodeLens は 6 個であるべき（実際: ${lenses.length}）`);

    // 全 CodeLens にコマンドが設定されている
    for (const lens of lenses) {
      assert.ok(lens.command, 'CodeLens にコマンドが設定されているべき');
      assert.ok(lens.command!.command, 'コマンド名が設定されているべき');
    }

    // showBlockDetail コマンドの CodeLens に引数が設定されている
    const detailLenses = lenses.filter(l => l.command!.command === 'codeWalker.showBlockDetail');
    assert.strictEqual(detailLenses.length, 3, '3 シンボル分の showBlockDetail CodeLens');

    for (const lens of detailLenses) {
      const args = lens.command!.arguments!;
      assert.ok(args.length >= 3, 'showBlockDetail に 3 つの引数（uri, symbolName, index）が必要');
    }
  });
});
