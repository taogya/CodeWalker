/**
 * deleteBlock.ts — ブロック削除コマンド
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockStore } from '@walker/blockStore';
import { CacheService } from '@cache/cacheService';
import { buildSymbolOwnerKey, clearSymbolByUri, highlightBlocks, setAnnotations, type BlockRange, type LineAnnotation } from '@walker/highlighter';
import { toCacheRelPath } from '@utils/fileUtils';
import { log } from '@utils/logger';
import { notifyInfo } from '@utils/notifications';
import type { CachedBlock, CachedFileExport, CachedSymbolEntry, CacheSource } from '@cache/cacheTypes';

export async function deleteBlockCommand(
  blockStore: BlockStore,
  cacheService: CacheService,
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
): Promise<void> {
  log('deleteBlockCommand: start', { uri: uri.toString(), symbolName, blockIndex });
  const blockDetail = blockStore.getBlockDetail(uri, symbolName, blockIndex);
  const blockInfo = blockDetail?.block;
  if (!blockInfo || blockDetail?.source !== 'manual') {
    log('deleteBlockCommand: blockInfo not found', { uri: uri.toString(), symbolName, blockIndex });
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    l10n.t('Delete "{0}" (L{1}-L{2})?', blockInfo.label, String(blockInfo.startLine), String(blockInfo.endLine)),
    { modal: true },
    l10n.t('Delete'),
  );
  if (confirm !== l10n.t('Delete')) {
    log('deleteBlockCommand: cancelled by user', { symbolName, blockIndex });
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const cacheRelPath = toCacheRelPath(relativePath);
  const sourceBlockIndex = blockDetail.sourceBlockIndex ?? blockIndex;

  // BlockStore から削除
  blockStore.removeBlock(uri, symbolName, blockIndex);

  // キャッシュ JSON からも削除
  try {
    const data = await cacheService.readFile('walks-manual', cacheRelPath);
    if (data) {
      const entry = data.symbols[symbolName];
      if (entry) {
        entry.blocks.splice(sourceBlockIndex, 1);
        if (entry.blocks.length === 0) {
          delete data.symbols[symbolName];
        } else {
          entry.updatedAt = new Date().toISOString();
        }
        await cacheService.writeFile('walks-manual', cacheRelPath, data);
      }
    }
  } catch (err) {
    log('deleteBlock: cache update failed', { error: String(err), stack: (err as Error).stack });
  }

  // ハイライト再描画
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });
    clearSymbolByUri(uri, symbolName);
    await reapplySymbolFromCaches(editor, blockStore, cacheService, uri, symbolName, cacheRelPath);
  } catch { /* ignore */ }

  void notifyInfo(l10n.t('CodeWalker: "{0}" deleted.', blockInfo.label));
  log('deleteBlockCommand: completed', { uri: uri.toString(), symbolName, blockIndex, deletedLabel: blockInfo.label });
}

async function reapplySymbolFromCaches(
  editor: vscode.TextEditor,
  blockStore: BlockStore,
  cacheService: CacheService,
  uri: vscode.Uri,
  symbolName: string,
  cacheRelPath: string,
): Promise<void> {
  const details = blockStore.getBlockDetails(uri, symbolName);
  if (details && details.length > 0) {
    for (const source of ['manual', 'auto'] as const) {
      const sourceDetails = details.filter(detail => detail.source === source);
      const ranges: BlockRange[] = sourceDetails.map(detail => {
        const startLine = Math.max(0, detail.block.startLine - 1);
        const endLine = Math.min(editor.document.lineCount - 1, detail.block.endLine - 1);
        return {
          range: new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length),
          colorIndex: detail.block.colorIndex,
        };
      });
      highlightBlocks(editor, ranges, buildSymbolOwnerKey(symbolName, source));

      const cacheFile = await cacheService.readFile(source === 'manual' ? 'walks-manual' : 'walks-auto', cacheRelPath) as CachedFileExport | null;
      const cacheEntry = cacheFile?.symbols?.[symbolName];
      setAnnotations(editor, collectAnnotations(cacheEntry?.blocks ?? []), buildSymbolOwnerKey(symbolName, source));
    }
    return;
  }

  for (const source of ['manual', 'auto'] as const) {
    const data = await cacheService.readFile(source === 'manual' ? 'walks-manual' : 'walks-auto', cacheRelPath) as CachedFileExport | null;
    const entry = data?.symbols?.[symbolName];
    if (entry) {
      applyCachedSymbol(editor, blockStore, uri, symbolName, entry, source);
    }
  }
}

function applyCachedSymbol(
  editor: vscode.TextEditor,
  blockStore: BlockStore,
  uri: vscode.Uri,
  symbolName: string,
  entry: CachedSymbolEntry,
  source: CacheSource,
): void {
  const doc = editor.document;
  const ownerKey = buildSymbolOwnerKey(symbolName, source);
  const blockInfos = entry.blocks.map((block, index) => ({
    index,
    label: block.label,
    description: block.description,
    startLine: block.startLine,
    endLine: block.endLine,
    colorIndex: block.colorIndex ?? (index % 6),
  }));

  const ranges: BlockRange[] = blockInfos.map(block => {
    const startLine = Math.max(0, block.startLine - 1);
    const endLine = Math.min(doc.lineCount - 1, block.endLine - 1);
    return {
      range: new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length),
      colorIndex: block.colorIndex,
    };
  });

  highlightBlocks(editor, ranges, ownerKey);
  blockStore.setBlocks(uri, symbolName, blockInfos, source);

  const mergedDetails = blockStore.getBlockDetails(uri, symbolName) ?? [];
  const sourceDetails = mergedDetails.filter(detail => detail.source === source);
  for (let index = 0; index < entry.blocks.length; index++) {
    const explanation = entry.blocks[index].explanation;
    if (explanation) {
      const globalIndex = sourceDetails.find(detail => detail.sourceBlockIndex === index)?.block.index;
      if (globalIndex !== undefined) {
        blockStore.setExplanation(uri, symbolName, globalIndex, explanation);
      }
    }
  }

  setAnnotations(editor, collectAnnotations(entry.blocks), ownerKey);
}

function collectAnnotations(blocks: CachedBlock[]): LineAnnotation[] {
  const annotations: LineAnnotation[] = [];
  for (const block of blocks) {
    if (!block.annotations) { continue; }
    for (const annotation of block.annotations) {
      annotations.push({ line: annotation.line, text: annotation.text });
    }
  }
  return annotations;
}
