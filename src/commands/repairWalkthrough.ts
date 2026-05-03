import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { CacheService } from '@cache/cacheService';
import type { BlockStore } from '@walker/blockStore';
import { repairSidebarNodeCommand } from '@sidebar/sidebarCommands';
import type { SidebarNode, WalkthroughBlockNode, WalkthroughFileNode, WalkthroughSymbolNode } from '@sidebar/types';
import { openFileInEditor } from '@utils/fileUtils';
import { notifyInfo, notifyWarning } from '@utils/notifications';

export async function repairWalkthroughCommand(
  blockStore: BlockStore,
  cacheService: CacheService,
  extensionUri: vscode.Uri,
  restoredUris: Set<string>,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  refreshSidebar: () => Promise<void>,
  uri?: vscode.Uri,
  symbolName?: string,
  blockIndex?: number,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri || targetUri.scheme !== 'file') {
    void notifyWarning(l10n.t('CodeWalker: No active editor is available.'));
    return;
  }

  let node = buildRepairNode(blockStore, targetUri, symbolName, blockIndex);
  if (!node) {
    const editor = await openFileInEditor(targetUri, { preserveFocus: true, preferExistingEditor: true });
    await restoreFromCache(editor, blockStore, cacheService);
    node = buildRepairNode(blockStore, targetUri, symbolName, blockIndex);
  }

  if (!node) {
    void notifyInfo(l10n.t('CodeWalker: No stale walkthrough block found.'));
    return;
  }

  await repairSidebarNodeCommand(
    node,
    blockStore,
    cacheService,
    extensionUri,
    restoredUris,
    restoreFromCache,
    refreshSidebar,
  );
}

function buildRepairNode(
  blockStore: BlockStore,
  uri: vscode.Uri,
  symbolName?: string,
  blockIndex?: number,
): SidebarNode | undefined {
  const symbolMap = blockStore.getSymbolMap(uri);
  if (!symbolMap || symbolMap.size === 0) {
    return undefined;
  }

  const filePath = vscode.workspace.asRelativePath(uri, false);
  const symbolNodes: WalkthroughSymbolNode[] = [];

  for (const [currentSymbolName, details] of symbolMap) {
    if (symbolName && currentSymbolName !== symbolName) {
      continue;
    }

    const blocks: WalkthroughBlockNode[] = details
      .filter(detail => detail.hashMismatch)
      .filter(detail => blockIndex === undefined || detail.block.index === blockIndex)
      .map<WalkthroughBlockNode>(detail => ({
        kind: 'walkthrough-block',
        id: `${filePath}::${currentSymbolName}::${detail.block.index}`,
        filePath,
        symbolName: currentSymbolName,
        blockIndex: detail.block.index,
        sourceBlockIndex: detail.sourceBlockIndex ?? detail.block.index,
        label: detail.block.label,
        startLine: detail.block.startLine,
        endLine: detail.block.endLine,
        description: detail.block.description,
        source: detail.source ?? 'manual',
        stale: true,
      }))
      .sort((left, right) => left.blockIndex - right.blockIndex);

    if (blocks.length === 0) {
      continue;
    }

    symbolNodes.push({
      kind: 'walkthrough-symbol',
      id: `${filePath}::${currentSymbolName}`,
      filePath,
      symbolName: currentSymbolName,
      source: blocks[0].source,
      hasManual: details.some(detail => detail.source === 'manual'),
      hasAuto: details.some(detail => detail.source === 'auto'),
      staleBlockCount: blocks.length,
      children: blocks,
    });
  }

  if (symbolNodes.length === 0) {
    return undefined;
  }

  const fileNode: WalkthroughFileNode = {
    kind: 'walkthrough-file',
    id: filePath,
    filePath,
    staleSymbolCount: symbolNodes.length,
    manualSymbolCount: symbolNodes.filter(node => node.hasManual && !node.hasAuto).length,
    autoSymbolCount: symbolNodes.filter(node => !node.hasManual && node.hasAuto).length,
    mixedSymbolCount: symbolNodes.filter(node => node.hasManual && node.hasAuto).length,
    children: symbolNodes,
  };

  return fileNode;
}