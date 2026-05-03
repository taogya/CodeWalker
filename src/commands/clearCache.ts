/**
 * clearCache.ts — キャッシュクリアコマンド
 *
 * ファイル / シンボル / Auto / Manual / 全削除の 5 オプション QuickPick。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { buildSymbolOwnerKey, clearAll as clearAllDecorations, clearSymbolByUri, clearSymbolOwnerByUri, clearUri as clearDecorationsForUri } from '@walker/highlighter';
import type { BlockStore } from '@walker/blockStore';
import { CacheService } from '@cache/cacheService';
import { toCacheRelPath } from '@utils/fileUtils';
import { log } from '@utils/logger';
import { notifyError, notifyInfo, notifyWarning } from '@utils/notifications';

export async function clearCacheCommand(
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
): Promise<void> {
  log('clearCacheCommand: start');
  if (!cacheService.hasWorkspace()) {
    log('clearCacheCommand: no workspace');
    void notifyWarning(l10n.t('CodeWalker: No workspace is open.'));
    return;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: l10n.t('$(file) Delete cache for current file'), description: l10n.t('Both Auto + Manual'), value: 'file' },
      { label: l10n.t('$(symbol-method) Delete by symbol in current file'), description: l10n.t('Specific symbol only'), value: 'symbol' },
      { label: l10n.t('$(trash) Delete all Auto cache'), description: l10n.t('Delete walks-auto/'), value: 'project-auto' },
      { label: l10n.t('$(trash) Delete all Manual cache'), description: l10n.t('Delete walks-manual/'), value: 'project-manual' },
      { label: l10n.t('$(warning) Delete all cache'), description: 'walks-auto/ + walks-manual/', value: 'project-both' },
    ],
    {
      title: l10n.t('CodeWalker: Clear Cache'),
      placeHolder: l10n.t('Select target to delete'),
      ignoreFocusOut: true,
    },
  );

  if (!choice) { return; }

  try {
    if (choice.value === 'symbol') {
      await handleDeleteSymbol(blockStore, cacheService);
    } else if (choice.value === 'file') {
      await handleDeleteFile(blockStore, cacheService, restoredUris);
    } else if (choice.value === 'project-auto') {
      await handleDeleteProjectSource(blockStore, cacheService, restoredUris, 'auto');
      void notifyInfo(l10n.t('CodeWalker: Auto cache deleted.'));
    } else if (choice.value === 'project-manual') {
      await handleDeleteProjectSource(blockStore, cacheService, restoredUris, 'manual');
      void notifyInfo(l10n.t('CodeWalker: Manual cache deleted.'));
    } else if (choice.value === 'project-both') {
      try { await cacheService.deleteSubDir('walks-auto'); } catch { /* */ }
      try { await cacheService.deleteSubDir('walks-manual'); } catch { /* */ }
      clearAllDecorations();
      blockStore.clear();
      restoredUris.clear();
      void notifyInfo(l10n.t('CodeWalker: All cache cleared.'));
    }

    log('clearCache', { scope: choice.value });
  } catch (err) {
    log('clearCache failed', { error: String(err), stack: (err as Error).stack });
    void notifyError(l10n.t('CodeWalker: Cache deletion failed — {0}', String(err)));
  }
}

// ── シンボル単位削除 ──

async function handleDeleteSymbol(
  blockStore: BlockStore,
  cacheService: CacheService,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    void notifyWarning(l10n.t('CodeWalker: No active file.'));
    return;
  }

  const symbolNames = blockStore.getSymbolNames(editor.document.uri);
  if (symbolNames.length === 0) {
    void notifyInfo(l10n.t('CodeWalker: No symbols displayed.'));
    return;
  }

  const symChoice = await vscode.window.showQuickPick(
    symbolNames.map(s => ({ label: s })),
    { title: l10n.t('Select symbol to delete'), placeHolder: l10n.t('Symbol name') },
  );
  if (!symChoice) { return; }

  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const cacheRelPath = toCacheRelPath(relativePath);

  // 両キャッシュから該当シンボルを削除
  for (const sub of ['walks-manual', 'walks-auto'] as const) {
    const data = await cacheService.readFile(sub, cacheRelPath);
    if (data && data.symbols[symChoice.label]) {
      delete data.symbols[symChoice.label];
      await cacheService.writeFile(sub, cacheRelPath, data);
    }
  }

  blockStore.removeSymbol(editor.document.uri, symChoice.label);
  clearSymbolByUri(editor.document.uri, symChoice.label);
  void notifyInfo(l10n.t('CodeWalker: Cache for symbol "{0}" deleted.', symChoice.label));
  log('clearCache: symbol deleted', { symbol: symChoice.label });
}

// ── ファイル単位削除 ──

async function handleDeleteFile(
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    void notifyWarning(l10n.t('CodeWalker: No active file.'));
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const cacheRelPath = toCacheRelPath(relativePath);

  let deleted = 0;
  for (const sub of ['walks-auto', 'walks-manual'] as const) {
    if (await cacheService.deleteFile(sub, cacheRelPath)) { deleted++; }
    if (await cacheService.deleteDir(sub, cacheRelPath)) { deleted++; }
  }

  if (deleted > 0) {
    blockStore.clearUri(editor.document.uri);
    clearDecorationsForUri(editor.document.uri.toString());
    restoredUris.delete(editor.document.uri.toString());
    void notifyInfo(l10n.t('CodeWalker: Cache for {0} deleted.', relativePath));
  } else {
    void notifyInfo(l10n.t('CodeWalker: No cache found to delete.'));
  }
}

async function handleDeleteProjectSource(
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
  source: 'manual' | 'auto',
): Promise<void> {
  const subDir = source === 'manual' ? 'walks-manual' : 'walks-auto';
  await cacheService.deleteSubDir(subDir);

  for (const uri of blockStore.getUris()) {
    const symbols = blockStore.getSymbolNamesBySource(uri, source);
    for (const symbolName of symbols) {
      blockStore.removeBlocksBySource(uri, symbolName, source);
      clearSymbolOwnerByUri(uri, buildSymbolOwnerKey(symbolName, source));
      if (!blockStore.getBlockDetails(uri, symbolName)?.length) {
        clearSymbolByUri(uri, symbolName);
      }
    }
    if (blockStore.getSymbolNames(uri).length === 0) {
      restoredUris.delete(uri.toString());
    }
  }
}
