/**
 * editBlock.ts — ブロック編集 / Auto→Manual インポートコマンド
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockStore } from '@walker/blockStore';
import { CacheService } from '@cache/cacheService';
import { showBlockEditPanel, type BlockEditInitData } from '@walker/blockEditPanel';
import { toCacheRelPath } from '@utils/fileUtils';
import { log } from '@utils/logger';
import { notifyWarning } from '@utils/notifications';

export async function editBlockCommand(
  blockStore: BlockStore,
  cacheService: CacheService,
  extensionUri: vscode.Uri,
  restoredUris: Set<string>,
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
  isImport?: boolean,
): Promise<void> {
  log('editBlockCommand: start', { uri: uri.toString(), symbolName, blockIndex, isImport });
  const blockDetail = blockStore.getBlockDetail(uri, symbolName, blockIndex);
  const blockInfo = blockDetail?.block;
  if (!blockInfo) {
    log('editBlockCommand: blockInfo not found', {
      uri: uri.toString(), symbolName, blockIndex,
      availableSymbols: blockStore.getSymbolNames(uri),
      blocksForSymbol: blockStore.getBlockDetails(uri, symbolName)?.length ?? 0,
    });
    void notifyWarning(l10n.t('CodeWalker: Block info not found.'));
    return;
  }

  const explanation = blockStore.getExplanation(uri, symbolName, blockIndex) ?? '';

  // アノテーションは Cache JSON から読み込む
  let annotations: { line: number; text: string }[] = [];
  try {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const cacheRelPath = toCacheRelPath(relativePath);
    const sourceBlockIndex = blockDetail?.sourceBlockIndex ?? blockIndex;
    const sources = blockDetail?.source
      ? [blockDetail.source === 'manual' ? 'walks-manual' : 'walks-auto'] as const
      : ['walks-manual', 'walks-auto'] as const;
    for (const sub of sources) {
      const data = await cacheService.readFile(sub, cacheRelPath);
      const block = data?.symbols[symbolName]?.blocks[sourceBlockIndex];
      if (block?.annotations) {
        annotations = block.annotations;
        break;
      }
    }
  } catch { /* ignore */ }

  log('editBlockCommand: opening edit panel', {
    symbolName, blockIndex, isImport,
    label: blockInfo.label,
    range: `L${blockInfo.startLine}-L${blockInfo.endLine}`,
    annotationCount: annotations.length,
    explanationLength: explanation.length,
  });

  const data: BlockEditInitData = {
    fileUri: uri,
    symbolName,
    blockIndex: isImport ? -1 : blockIndex, // インポート時は新規扱い
    source: blockDetail?.source,
    sourceBlockIndex: blockDetail?.sourceBlockIndex ?? blockIndex,
    label: blockInfo.label,
    startLine: blockInfo.startLine,
    endLine: blockInfo.endLine,
    colorIndex: blockInfo.colorIndex,
    description: blockInfo.description ?? '',
    explanation,
    annotations,
    isImport: !!isImport,
  };

  showBlockEditPanel(data, blockStore, cacheService, extensionUri, () => {
    restoredUris.add(uri.toString());
  });

  log('editBlockCommand: panel opened', { uri: uri.toString(), symbolName, blockIndex, isImport });
}
