/**
 * addBlock.ts — ブロック追加コマンド（右クリック / コマンドパレット）
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { loadConfig } from '@cache/configReader';
import type { BlockStore } from '@walker/blockStore';
import { showBlockEditPanel, type BlockEditInitData } from '@walker/blockEditPanel';
import { log } from '@utils/logger';
import { notifyWarning } from '@utils/notifications';
import type { CacheService } from '@cache/cacheService';

export function addBlockCommand(
  blockStore: BlockStore,
  cacheService: CacheService,
  extensionUri: vscode.Uri,
  restoredUris: Set<string>,
): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    log('addBlockCommand: no active file editor', { scheme: editor?.document.uri.scheme });
    void notifyWarning(l10n.t('CodeWalker: No active file.'));
    return;
  }

  const selection = editor.selection;
  const startLine = selection.start.line + 1; // 1-based
  const endLine = selection.end.line + 1;
  const colorIndex = Math.max(0, Math.min(5, loadConfig().defaultColor));

  const data: BlockEditInitData = {
    fileUri: editor.document.uri,
    symbolName: '',
    blockIndex: -1,
    label: '',
    startLine,
    endLine: endLine > startLine ? endLine : startLine,
    colorIndex,
    description: '',
    explanation: '',
    annotations: [],
    isImport: false,
    source: 'manual',
    sourceBlockIndex: -1,
  };

  showBlockEditPanel(data, blockStore, cacheService, extensionUri, () => {
    restoredUris.add(editor.document.uri.toString());
  });

  log('addBlockCommand', {
    uri: editor.document.uri.toString(),
    startLine, endLine,
    colorIndex,
    selectionIsEmpty: selection.isEmpty,
    existingSymbols: blockStore.getSymbolNames(editor.document.uri),
  });
}
