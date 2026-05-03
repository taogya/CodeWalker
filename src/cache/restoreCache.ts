/**
 * restoreCache.ts — キャッシュからのウォークスルー表示復元
 *
 * VS Code 起動時やファイルオープン時に、
 * .code-walker/walks-manual/ → walks-auto/ の優先順で
 * ハイライト・CodeLens・アノテーション・解説を復元する。
 * fileHash の不一致時は ⚠ 通知を表示する。
 *
 * A-2 リファクタリング: CacheService 経由でキャッシュ I/O。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { toCacheRelPath, computeBlockHash } from '@utils/fileUtils';
import { buildSymbolOwnerKey, highlightBlocks, setAnnotations, type BlockRange, type LineAnnotation } from '@walker/highlighter';
import type { BlockStore } from '@walker/blockStore';
import type { BlockInfo } from '@analysis/contextBuilder';
import type { CachedSymbolEntry, CacheSource } from './cacheTypes';
import { CacheService } from './cacheService';
import { log } from '@utils/logger';
import { notifyWarning } from '@utils/notifications';

/** 復元済みシンボル情報（source 付き） */
interface RestoredSymbol {
  symbolName: string;
  entry: CachedSymbolEntry;
  source: CacheSource;
}

/**
 * 指定ファイルに対応するキャッシュを読み込み、
 * エディタにハイライト・CodeLens・解説を復元する。
 */
export async function restoreFromCache(
  editor: vscode.TextEditor,
  blockStore: BlockStore,
  cacheService: CacheService,
): Promise<boolean> {
  const uri = editor.document.uri;
  log('restoreFromCache: start', { uri: uri.toString(), scheme: uri.scheme });
  if (uri.scheme !== 'file') {
    log('restoreFromCache: skipped (non-file scheme)', { scheme: uri.scheme });
    return false;
  }
  if (!cacheService.hasWorkspace()) {
    log('restoreFromCache: skipped (no workspace)');
    return false;
  }

  // ワークスペース相対パスを取得
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const cacheRelPath = toCacheRelPath(relativePath);

  const restoredSymbols: RestoredSymbol[] = [];

  // 1. walks-manual/ を読み込み
  const manualData = await cacheService.readFile('walks-manual', cacheRelPath);
  if (manualData) {
    for (const [name, entry] of Object.entries(manualData.symbols)) {
      // [DIAG:B6] source が未定義のマニュアルキャッシュエントリを検出
      if (entry.source === undefined) {
        log('[DIAG:B6] Manual cache entry has no source field — will fallback to "manual"', {
          symbolName: name,
          cacheRelPath,
          entryKeys: Object.keys(entry),
        });
      }
      restoredSymbols.push({ symbolName: name, entry, source: entry.source ?? 'manual' });
    }
  }

  // 2. walks-auto/ を読み込み（同一シンボルでも共存させる）
  const autoData = await cacheService.readFile('walks-auto', cacheRelPath);
  if (autoData) {
    for (const [name, entry] of Object.entries(autoData.symbols)) {
      // [DIAG:B6] source が未定義のオートキャッシュエントリを検出
      if (entry.source === undefined) {
        log('[DIAG:B6] Auto cache entry has no source field — will fallback to "auto"', {
          symbolName: name,
          cacheRelPath,
        });
      }
      if (restoredSymbols.some(symbol => symbol.symbolName === name && symbol.source === 'manual')) {
        log('[DIAG:B5] Symbol exists in both manual and auto cache — both sources will be restored', {
          symbolName: name,
          cacheRelPath,
        });
      }
      restoredSymbols.push({ symbolName: name, entry, source: entry.source ?? 'auto' });
    }
  }

  if (restoredSymbols.length === 0) {
    log('restoreFromCache: no symbols found in cache', { cacheRelPath });
    return false;
  }

  log('restoreFromCache: symbols loaded', {
    cacheRelPath,
    symbolCount: restoredSymbols.length,
    symbols: restoredSymbols.map(({ symbolName, source }) => ({ name: symbolName, source })),
  });

  // blockHash 検証: ブロック単位でハッシュを比較し、変更されたブロックだけに⚠を付ける
  // (後のループでブロックごとに検証)

  const doc = editor.document;

  // 全シンボルのキャッシュを読み込み（シンボル単位で CodeLens 登録）
  let totalBlocks = 0;
  let totalExplanations = 0;

  for (const { symbolName, entry, source } of restoredSymbols) {
    try {
      const symbolBlockInfos: BlockInfo[] = [];
      const ownerKey = buildSymbolOwnerKey(symbolName, source);
      log('restoreFromCache: restoring symbol', {
        symbolName, source,
        blockCount: entry.blocks.length,
        blockLabels: entry.blocks.map(b => b.label),
      });

      const symbolAnnotations: LineAnnotation[] = [];

      for (let i = 0; i < entry.blocks.length; i++) {
        const b = entry.blocks[i];

        symbolBlockInfos.push({
          index: i,
          label: b.label,
          description: b.description,
          startLine: b.startLine,
          endLine: b.endLine,
          colorIndex: b.colorIndex ?? (i % 6),
        });

        // アノテーション
        if (b.annotations) {
          for (const a of b.annotations) {
            symbolAnnotations.push({ line: a.line, text: a.text });
          }
        }
      }

      // シンボル単位でハイライト + CodeLens 登録
      const blockRanges: BlockRange[] = symbolBlockInfos.map(b => {
        const startLine = Math.max(0, b.startLine - 1);
        const endLine = Math.min(doc.lineCount - 1, b.endLine - 1);
        return {
          range: new vscode.Range(
            startLine, 0,
            endLine, doc.lineAt(endLine).text.length,
          ),
          colorIndex: b.colorIndex,
        };
      });
      highlightBlocks(editor, blockRanges, ownerKey);

      blockStore.setBlocks(uri, symbolName, symbolBlockInfos, source);

      // ブロック単位でハッシュ検証 + 解説設定
      let symbolHasMismatch = false;
      for (let i = 0; i < entry.blocks.length; i++) {
        const b = entry.blocks[i];

        // blockHash 検証
        if (b.blockHash) {
          try {
            const currentHash = await computeBlockHash(uri, b.startLine, b.endLine);
            if (currentHash !== b.blockHash) {
              blockStore.setBlockHashMismatch(uri, symbolName, i, true);
              symbolHasMismatch = true;
              log('restoreFromCache: blockHash mismatch', {
                symbolName, blockIndex: i, label: b.label,
                cached: b.blockHash.slice(0, 20) + '...',
                current: currentHash.slice(0, 20) + '...',
              });
            }
          } catch (err) {
            log('restoreFromCache: block hash check failed', { error: String(err), block: b.label });
          }
        }

        // 解説
        if (b.explanation) {
          blockStore.setExplanation(uri, symbolName, i, b.explanation);
          totalExplanations++;
        }
      }
      if (symbolHasMismatch) {
        void notifyWarning(
          l10n.t('CodeWalker: Some blocks in {0}/{1} were modified since the cache was created.', relativePath, symbolName),
        );
      }

      setAnnotations(editor, symbolAnnotations, ownerKey);

      totalBlocks += symbolBlockInfos.length;
    } catch (err) {
      log('restoreFromCache: failed to restore symbol', {
        symbolName,
        error: String(err),
        stack: (err as Error).stack,
      });
    }
  }

  if (totalBlocks === 0) {
    log('restoreFromCache: no blocks restored', { cacheRelPath });
    return false;
  }

  log('restoreFromCache: restored', {
    filePath: relativePath,
    symbols: restoredSymbols.length,
    blocks: totalBlocks,
    annotations: restoredSymbols.reduce((sum, { entry }) => sum + entry.blocks.reduce((blockSum, block) => blockSum + (block.annotations?.length ?? 0), 0), 0),
    explanations: totalExplanations,
    sourceBreakdown: restoredSymbols.map(({ symbolName, source }) => ({ name: symbolName, source })),
  });

  return true;
}
