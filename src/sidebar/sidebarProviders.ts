import * as path from 'path';
import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { resolveFileUri } from '@utils/fileUtils';
import type { SidebarDataService } from './sidebarDataService';
import { buildFilePathHierarchy, type FolderNode } from './treeHierarchy';
import type {
  SidebarNode,
  SidebarSnapshot,
  SidebarTargetStatus,
  TargetEntryNode,
  TargetStatusNode,
  UncoveredFileNode,
  WalkthroughBlockNode,
  WalkthroughFileNode,
  WalkthroughNode,
  WalkthroughSymbolNode,
} from './types';

interface InfoNode {
  kind: 'info';
  message: string;
}

type HierarchyLeaf = WalkthroughFileNode | TargetEntryNode | UncoveredFileNode;
type TreeNode = SidebarNode | InfoNode | FolderNode<HierarchyLeaf>;

export class WalkthroughTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly dataService: SidebarDataService,
    private readonly mode: 'walkthrough' | 'stale',
  ) {
    this.dataService.onDidChange(() => {
      this.onDidChangeTreeDataEmitter.fire();
    });
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const snapshot = await this.dataService.getSnapshot();
      const roots = this.mode === 'walkthrough' ? snapshot.walkthroughFiles : snapshot.staleFiles;
      if (roots.length === 0) {
        return [{
          kind: 'info',
          message: this.mode === 'walkthrough'
            ? l10n.t('No walkthrough cache found.')
            : l10n.t('No stale walkthroughs found.'),
        }];
      }
      return buildFilePathHierarchy(roots, `${this.mode}::root`);
    }

    if (element.kind === 'folder') {
      return element.children;
    }

    if (element.kind === 'walkthrough-file') {
      return element.children;
    }
    if (element.kind === 'walkthrough-symbol') {
      return element.children;
    }
    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'info') {
      return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
    }

    if (element.kind === 'folder') {
      return this.folderItem(element);
    }

    if (element.kind === 'walkthrough-file') {
      return this.fileItem(element);
    }
    if (element.kind === 'walkthrough-symbol') {
      return this.symbolItem(element);
    }
    return this.blockItem(element as WalkthroughBlockNode);
  }

  private folderItem(node: FolderNode<HierarchyLeaf>): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.tooltip = node.folderPath;
    item.iconPath = vscode.ThemeIcon.Folder;
    return item;
  }

  private fileItem(node: WalkthroughFileNode): vscode.TreeItem {
    const collapsibleState = node.children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(resolveFileUri(node.filePath), collapsibleState);
    item.id = node.id;
    item.contextValue = node.staleSymbolCount > 0 ? 'codeWalkerSidebar.fileStale' : 'codeWalkerSidebar.file';
    item.description = this.fileDescription(node);
    item.tooltip = node.filePath;
    item.command = {
      command: 'codeWalker.sidebar.openNode',
      title: l10n.t('Open'),
      arguments: [node],
    };
    item.iconPath = node.staleSymbolCount > 0 ? new vscode.ThemeIcon('warning') : vscode.ThemeIcon.File;
    return item;
  }

  private symbolItem(node: WalkthroughSymbolNode): vscode.TreeItem {
    const item = new vscode.TreeItem(`${this.sourceBadge(node)} ${node.symbolName}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.contextValue = node.staleBlockCount > 0 ? 'codeWalkerSidebar.symbolStale' : 'codeWalkerSidebar.symbol';
    item.description = this.symbolDescription(node);
    item.tooltip = `${node.filePath} :: ${node.symbolName}`;
    item.command = {
      command: 'codeWalker.sidebar.openNode',
      title: l10n.t('Open'),
      arguments: [node],
    };
    item.iconPath = this.symbolIcon(node);
    return item;
  }

  private blockItem(node: WalkthroughBlockNode): vscode.TreeItem {
    const item = new vscode.TreeItem(`${node.source === 'manual' ? '[M]' : '[A]'} ${this.blockPrefix(node.blockIndex)} ${node.label}`, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.contextValue = node.stale ? 'codeWalkerSidebar.blockStale' : 'codeWalkerSidebar.block';
    item.description = `${this.sourceLabel(node.source)} • L${node.startLine}-L${node.endLine}${node.stale ? ' • ⚠' : ''}`;
    item.tooltip = `${node.filePath} :: ${node.symbolName} :: ${node.label}`;
    item.command = {
      command: 'codeWalker.sidebar.showNodeDetail',
      title: l10n.t('Show Detail'),
      arguments: [node],
    };
    item.iconPath = node.stale ? new vscode.ThemeIcon('warning') : new vscode.ThemeIcon('symbol-field');
    return item;
  }

  private fileDescription(node: WalkthroughFileNode): string {
    const symbolCount = l10n.t('{0} symbols', String(node.children.length));
    const sourceParts = [
      node.mixedSymbolCount > 0 ? l10n.t('{0} mixed', String(node.mixedSymbolCount)) : undefined,
      node.manualSymbolCount > 0 ? l10n.t('{0} manual', String(node.manualSymbolCount)) : undefined,
      node.autoSymbolCount > 0 ? l10n.t('{0} auto', String(node.autoSymbolCount)) : undefined,
    ].filter((part): part is string => !!part);
    const registeredSummary = sourceParts.length > 0
      ? `${l10n.t('Registered')} • ${sourceParts.join(' • ')}`
      : l10n.t('Registered');
    if (node.staleSymbolCount === 0) {
      return `${registeredSummary} • ${symbolCount}`;
    }
    return `${registeredSummary} • ${symbolCount} • ${l10n.t('{0} stale', String(node.staleSymbolCount))}`;
  }

  private symbolDescription(node: WalkthroughSymbolNode): string {
    const manualCount = node.children.filter(child => child.source === 'manual').length;
    const autoCount = node.children.filter(child => child.source === 'auto').length;
    const source = node.hasManual && node.hasAuto
      ? `${l10n.t('Manual')} ${manualCount} • ${l10n.t('Auto')} ${autoCount}`
      : this.sourceLabel(node.source);
    if (node.staleBlockCount === 0) {
      return `${source} • ${node.children.length}`;
    }
    return `${source} • ${l10n.t('{0} stale', String(node.staleBlockCount))}`;
  }

  private symbolIcon(node: WalkthroughSymbolNode): vscode.ThemeIcon {
    if (node.staleBlockCount > 0) {
      return new vscode.ThemeIcon('warning');
    }
    if (node.hasManual && node.hasAuto) {
      return new vscode.ThemeIcon('layers');
    }
    if (node.hasManual) {
      return new vscode.ThemeIcon('edit');
    }
    return new vscode.ThemeIcon('sparkle');
  }

  private sourceBadge(node: WalkthroughSymbolNode): string {
    if (node.hasManual && node.hasAuto) {
      return '[M+A]';
    }
    return node.hasManual ? '[M]' : '[A]';
  }

  private sourceLabel(source: 'manual' | 'auto'): string {
    return source === 'manual' ? l10n.t('Manual') : l10n.t('Auto');
  }

  private blockPrefix(index: number): string {
    const labels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    return labels[index] ?? `(${index + 1})`;
  }
}

export class BatchTargetsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly dataService: SidebarDataService) {
    this.dataService.onDidChange(() => {
      this.onDidChangeTreeDataEmitter.fire();
    });
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const snapshot = await this.dataService.getSnapshot();
      const hasTargets = snapshot.targetGroups.some(group => group.children.length > 0);
      if (!hasTargets) {
        return [{ kind: 'info', message: l10n.t('No batch targets found.') }];
      }
      return snapshot.targetGroups;
    }

    if (element.kind === 'folder') {
      return element.children;
    }

    if (element.kind === 'target-status') {
      return buildFilePathHierarchy(
        element.children,
        `${element.id}::root`,
        entry => `${path.posix.basename(entry.filePath)}::${entry.symbolName}::${String(entry.line)}`,
      );
    }
    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'info') {
      return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
    }
    if (element.kind === 'folder') {
      return this.folderItem(element);
    }
    if (element.kind === 'target-status') {
      return this.statusItem(element);
    }
    return this.targetItem(element as TargetEntryNode);
  }

  private folderItem(node: FolderNode<HierarchyLeaf>): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.tooltip = node.folderPath;
    item.iconPath = vscode.ThemeIcon.Folder;
    return item;
  }

  private statusItem(node: TargetStatusNode): vscode.TreeItem {
    const item = new vscode.TreeItem(this.statusLabel(node.status), vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.contextValue = 'codeWalkerSidebar.targetStatus';
    item.description = l10n.t('{0} items', String(node.children.length));
    item.iconPath = this.statusIcon(node.status);
    return item;
  }

  private targetItem(node: TargetEntryNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.symbolName, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.contextValue = 'codeWalkerSidebar.target';
    item.description = `${path.basename(node.filePath)} • L${node.line}`;
    item.tooltip = `${node.filePath} :: ${node.symbolName} (${node.targetKind})`;
    item.iconPath = this.statusIcon(node.status);
    item.command = {
      command: 'codeWalker.sidebar.openNode',
      title: l10n.t('Open'),
      arguments: [node],
    };
    return item;
  }

  private statusLabel(status: SidebarTargetStatus): string {
    switch (status) {
      case 'pending':
        return l10n.t('Pending');
      case 'done':
        return l10n.t('Done');
      case 'skip':
        return l10n.t('Skipped');
    }
  }

  private statusIcon(status: SidebarTargetStatus): vscode.ThemeIcon {
    switch (status) {
      case 'pending':
        return new vscode.ThemeIcon('clock');
      case 'done':
        return new vscode.ThemeIcon('pass');
      case 'skip':
        return new vscode.ThemeIcon('debug-step-over');
    }
  }
}

export class UncoveredFilesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly dataService: SidebarDataService) {
    this.dataService.onDidChange(() => {
      this.onDidChangeTreeDataEmitter.fire();
    });
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const snapshot = await this.dataService.getSnapshot();
      if (snapshot.uncoveredFiles.length === 0) {
        return [{ kind: 'info', message: l10n.t('No uncovered files found.') }];
      }
      return buildFilePathHierarchy(snapshot.uncoveredFiles, 'uncovered::root');
    }

    if (element.kind === 'folder') {
      return element.children;
    }

    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'info') {
      return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
    }
    if (element.kind === 'folder') {
      return this.folderItem(element);
    }
    return this.fileItem(element as UncoveredFileNode);
  }

  private folderItem(node: FolderNode<HierarchyLeaf>): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.tooltip = node.folderPath;
    item.iconPath = vscode.ThemeIcon.Folder;
    return item;
  }

  private fileItem(node: UncoveredFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(resolveFileUri(node.filePath), vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.contextValue = 'codeWalkerSidebar.uncoveredFile';
    item.description = l10n.t('Uncovered');
    item.tooltip = node.filePath;
    item.command = {
      command: 'codeWalker.sidebar.openNode',
      title: l10n.t('Open'),
      arguments: [node],
    };
    item.iconPath = vscode.ThemeIcon.File;
    return item;
  }
}

export async function getWalkthroughSnapshot(dataService: SidebarDataService): Promise<SidebarSnapshot> {
  return dataService.getSnapshot();
}