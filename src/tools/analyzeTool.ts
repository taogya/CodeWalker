/**
 * analyzeTool.ts — code_walker_analyze ツール
 *
 * 関数/クラスの構造を解析し、シンボル情報とソースコードを返す。
 * ブロック分割・色分け・CodeLens は highlight ツールに委譲。
 *
 * A-2 リファクタリング: CacheService 経由でキャッシュ読み込み。
 */

import * as vscode from 'vscode';
import { findSymbol } from '@walker/symbolFinder';
import { setWalkState } from '@walker/state';
import { resolveFileUri, openFileInEditor, lineRange, toCacheRelPath } from '@utils/fileUtils';
import { loadReverseEngineerContext } from '@analysis/reverseReader';
import { buildAnalyzeResult, type AnalyzeResult, type CachedWalkthrough } from '@analysis/contextBuilder';
import { CacheService } from '@cache/cacheService';
import type { CacheSource } from '@cache/cacheTypes';
import type { BlockStore } from '@walker/blockStore';
import { clearSymbol } from '@walker/highlighter';
import { log } from '@utils/logger';

/** ツール入力スキーマ */
interface AnalyzeInput {
  filePath: string;
  symbolName: string;
  depth?: number;
  startLine?: number;
  endLine?: number;
}

export class AnalyzeTool implements vscode.LanguageModelTool<AnalyzeInput> {

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _cacheService: CacheService,
    private readonly _blockStore?: BlockStore,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AnalyzeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, symbolName, depth = 1, startLine, endLine } = options.input;
    log('AnalyzeTool.invoke() called', { filePath, symbolName, depth, startLine, endLine });

    // 1. ファイルを開く
    const uri = resolveFileUri(filePath);
    const editor = await openFileInEditor(uri);
    const doc = editor.document;

    // 1b. stale な BlockStore データ + ハイライトをクリア (B4)
    if (this._blockStore) {
      const existingSymbols = this._blockStore.getSymbolNames(uri);
      if (existingSymbols.includes(symbolName)) {
        log('AnalyzeTool: clearing stale BlockStore data', { filePath, symbolName });
        this._blockStore.removeSymbol(uri, symbolName);
        clearSymbol(editor, symbolName);
      }
    }

    // 2. シンボルを検索
    const symbol = await findSymbol(uri, symbolName);
    log('Symbol search result', { found: !!symbol, symbolName, range: symbol ? { start: symbol.range.start.line, end: symbol.range.end.line } : null });
    if (!symbol) {
      log('AnalyzeTool: symbol not found', { filePath, symbolName });
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify({
            error: `Symbol "${symbolName}" not found in ${filePath}`,
            suggestion: 'Verify the symbol name and ensure a language server is active for this file type.',
          }),
        ),
      ]);
    }

    // 3. 解析範囲を決定
    let targetRange: vscode.Range;
    if (startLine && endLine) {
      targetRange = lineRange(doc, startLine, endLine);
    } else {
      targetRange = symbol.range;
    }

    // 4. ソースコード取得
    const sourceCode = doc.getText(targetRange);

    // 5. ウォーク状態を更新
    setWalkState({
      fileUri: uri,
      symbolName,
      depth,
      currentRange: {
        startLine: targetRange.start.line + 1,
        endLine: targetRange.end.line + 1,
      },
    });

    // 6. .reverse-engineer/ コンテキスト読み取り
    const systemContext = await loadReverseEngineerContext(filePath, symbolName);

    // 7. キャッシュ読み込み
    const cachedWalkthrough = await loadCachedWalkthrough(this._cacheService, filePath, symbolName);
    if (cachedWalkthrough) {
      log('Cached walkthrough found', { createdAt: cachedWalkthrough.createdAt, blockCount: cachedWalkthrough.blocks.length });
    }

    // 8. 子シンボル情報を収集
    const childSymbols = symbol.children.map((child) => ({
      name: child.name,
      kind: vscode.SymbolKind[child.kind],
      startLine: child.range.start.line + 1,
      endLine: child.range.end.line + 1,
    }));

    // 9. 結果を構築して返す
    const result: AnalyzeResult = {
      symbolName,
      filePath,
      range: {
        startLine: targetRange.start.line + 1,
        endLine: targetRange.end.line + 1,
      },
      sourceCode,
      depth,
      systemContext,
      childSymbols: childSymbols.length > 0 ? childSymbols : undefined,
      cachedWalkthrough: cachedWalkthrough ?? undefined,
    };

    log('AnalyzeTool.invoke() returning result', {
      symbolName,
      range: result.range,
      depth,
      hasContext: !!systemContext,
      hasCachedWalkthrough: !!cachedWalkthrough,
      childSymbolCount: childSymbols.length,
      sourceCodeLength: sourceCode.length,
    });

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(buildAnalyzeResult(result)),
    ]);
  }
}

/**
 * walks-manual/ → walks-auto/ の優先順でキャッシュを読み込む。
 * Manual に該当シンボルがあればそちらを返し、なければ Auto を返す。
 */
async function loadCachedWalkthrough(
  cacheService: CacheService,
  filePath: string,
  symbolName: string,
): Promise<CachedWalkthrough | null> {
  const cacheRelPath = toCacheRelPath(filePath);
  const dirs: { sub: 'walks-manual' | 'walks-auto'; source: CacheSource }[] = [
    { sub: 'walks-manual', source: 'manual' },
    { sub: 'walks-auto', source: 'auto' },
  ];

  for (const { sub, source } of dirs) {
    const data = await cacheService.readFile(sub, cacheRelPath);
    const symbolEntry = data?.symbols?.[symbolName];
    if (symbolEntry) {
      log('loadCachedWalkthrough: found', { sub, source, symbolName, blockCount: symbolEntry.blocks?.length ?? 0 });
      return {
        createdAt: symbolEntry.updatedAt ?? '',
        overview: symbolEntry.overview ?? '',
        blocks: symbolEntry.blocks ?? [],
        source,
      };
    }
  }

  return null;
}
