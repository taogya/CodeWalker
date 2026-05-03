/**
 * showBlockDetail.ts — ブロック詳細表示コマンド
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockStore } from '@walker/blockStore';
import { showBlockDetailPanel } from '@walker/blockDetailPanel';
import { lineRange, openFileInEditor } from '@utils/fileUtils';
import { log } from '@utils/logger';
import { notifyInfo } from '@utils/notifications';

export interface ShowBlockDetailOptions {
  revealEditor?: boolean;
  preserveEditorFocus?: boolean;
  revealType?: vscode.TextEditorRevealType;
}

export async function showBlockDetailCommand(
  blockStore: BlockStore,
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
  options: ShowBlockDetailOptions = {},
): Promise<void> {
  // [DIAG] リクエスト受信時のコンテキストを記録
  const symbolNames = blockStore.getSymbolNames(uri);
  const details = blockStore.getBlockDetails(uri, symbolName);
  log('[DIAG] showBlockDetail invoked', {
    uri: uri.toString(),
    symbolName,
    blockIndex,
    storeHasUri: symbolNames.length > 0,
    symbolsInStore: symbolNames,
    blocksForSymbol: details?.length ?? 0,
  });

  // [DIAG:B7] blockIndex がストア内ブロック数を超えている（削除後の stale index）
  if (details && blockIndex >= details.length) {
    log('[DIAG:B7] stale blockIndex — index exceeds available blocks', {
      blockIndex,
      availableBlocks: details.length,
      symbolName,
      uri: uri.toString(),
    });
  }

  // [DIAG:B4] BlockStore にデータがないのに CodeLens クリックが届いた
  if (symbolNames.length === 0) {
    log('[DIAG:B4] showBlockDetail called but BlockStore is empty for this URI', {
      uri: uri.toString(),
      symbolName,
      blockIndex,
    });
  }

  const blockInfo = blockStore.getBlockInfo(uri, symbolName, blockIndex);
  if (!blockInfo) {
    // [DIAG:B8] エラーメッセージにファイルパス・シンボル名が含まれていない
    const fileName = uri.path.split('/').pop() ?? uri.path;
    void notifyInfo(
      l10n.t('Block info not found: {0} / {1} [#{2}]', fileName, symbolName, String(blockIndex)),
    );
    return;
  }

  // ソースコードを取得
  let sourceCode = '';
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, blockInfo.startLine - 1);
    const endLine = Math.min(doc.lineCount - 1, blockInfo.endLine - 1);
    const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
    sourceCode = doc.getText(range);
  } catch {
    sourceCode = l10n.t('(Failed to retrieve source code)');
  }

  const explanation = blockStore.getExplanation(uri, symbolName, blockIndex);
  const fileName = uri.path.split('/').pop() ?? uri.path;

  if (options.revealEditor) {
    await revealBlockInEditor(uri, blockInfo.startLine, blockInfo.endLine, options);
  }

  // ナビゲーション用: 同一シンボル内の兄弟ブロック一覧
  const navDetails = blockStore.getBlockDetails(uri, symbolName);
  const siblings = navDetails
    ? navDetails.map(d => ({ index: d.block.index, label: d.block.label }))
    : [];

  showBlockDetailPanel({
    block: blockInfo,
    sourceCode,
    explanation,
    fileName,
    nav: siblings.length > 1
      ? { uriString: uri.toString(), symbolName, siblings }
      : undefined,
  });

  log('showBlockDetail command', { uri: uri.toString(), symbolName, blockIndex });
}

async function revealBlockInEditor(
  uri: vscode.Uri,
  startLine: number,
  endLine: number,
  options: ShowBlockDetailOptions,
): Promise<void> {
  const editor = await openFileInEditor(uri, {
    preserveFocus: options.preserveEditorFocus ?? false,
    preferExistingEditor: true,
  });
  editor.revealRange(
    lineRange(editor.document, startLine, endLine),
    options.revealType ?? vscode.TextEditorRevealType.InCenter,
  );
}
