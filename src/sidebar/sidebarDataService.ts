import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CachedBlock, CachedFileExport, CachedSymbolEntry } from '@cache/cacheTypes';
import type { CacheService } from '@cache/cacheService';
import { loadConfig } from '@cache/configReader';
import { resolveFileUri } from '@utils/fileUtils';
import { log } from '@utils/logger';
import type {
  SidebarSnapshot,
  SidebarTargetStatus,
  TargetEntryNode,
  TargetStatusNode,
  UncoveredFileNode,
  TargetsFile,
  WalkthroughBlockNode,
  WalkthroughFileNode,
  WalkthroughSymbolNode,
} from './types';

interface CacheSymbolPair {
  manual?: CachedSymbolEntry;
  auto?: CachedSymbolEntry;
}

export class SidebarDataService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private snapshot: SidebarSnapshot | undefined;
  private refreshPromise: Promise<SidebarSnapshot> | undefined;

  constructor(private readonly cacheService: CacheService) {}

  invalidate(): void {
    this.snapshot = undefined;
    this.onDidChangeEmitter.fire();
  }

  async refresh(): Promise<void> {
    this.snapshot = await this.buildSnapshot();
    this.refreshPromise = undefined;
    this.onDidChangeEmitter.fire();
  }

  async getSnapshot(): Promise<SidebarSnapshot> {
    if (this.snapshot) {
      return this.snapshot;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.buildSnapshot().then(snapshot => {
        this.snapshot = snapshot;
        this.refreshPromise = undefined;
        return snapshot;
      }).catch(error => {
        this.refreshPromise = undefined;
        throw error;
      });
    }
    return this.refreshPromise;
  }

  private async buildSnapshot(): Promise<SidebarSnapshot> {
    if (!this.cacheService.hasWorkspace()) {
      return { walkthroughFiles: [], uncoveredFiles: [], staleFiles: [], targetGroups: this.emptyTargetGroups() };
    }

    const mergedSymbols = await this.readMergedSymbols();
    const walkthroughFiles = await this.buildWalkthroughFiles(mergedSymbols, false);
    const uncoveredFiles = await this.buildUncoveredFiles(new Set(mergedSymbols.keys()));
    const staleFiles = await this.buildWalkthroughFiles(mergedSymbols, true);
    const targetGroups = await this.readTargets();

    log('SidebarDataService.buildSnapshot', {
      walkthroughFiles: walkthroughFiles.length,
      uncoveredFiles: uncoveredFiles.length,
      staleFiles: staleFiles.length,
      targetGroups: targetGroups.map(group => ({ status: group.status, count: group.children.length })),
    });

    return { walkthroughFiles, uncoveredFiles, staleFiles, targetGroups };
  }

  private async readMergedSymbols(): Promise<Map<string, Map<string, CacheSymbolPair>>> {
    const manualFiles = await this.readCacheExports('walks-manual');
    const autoFiles = await this.readCacheExports('walks-auto');
    const merged = new Map<string, Map<string, CacheSymbolPair>>();

    for (const [filePath, data] of manualFiles) {
      let fileMap = merged.get(filePath);
      if (!fileMap) {
        fileMap = new Map();
        merged.set(filePath, fileMap);
      }
      for (const [symbolName, entry] of Object.entries(data.symbols ?? {})) {
        const pair = fileMap.get(symbolName) ?? {};
        pair.manual = entry;
        fileMap.set(symbolName, pair);
      }
    }

    for (const [filePath, data] of autoFiles) {
      let fileMap = merged.get(filePath);
      if (!fileMap) {
        fileMap = new Map();
        merged.set(filePath, fileMap);
      }
      for (const [symbolName, entry] of Object.entries(data.symbols ?? {})) {
        const pair = fileMap.get(symbolName) ?? {};
        pair.auto = entry;
        fileMap.set(symbolName, pair);
      }
    }

    return merged;
  }

  private async buildWalkthroughFiles(
    mergedSymbols: Map<string, Map<string, CacheSymbolPair>>,
    staleOnly: boolean,
  ): Promise<WalkthroughFileNode[]> {
    const fileNodes: WalkthroughFileNode[] = [];

    for (const filePath of [...mergedSymbols.keys()].sort()) {
      const symbolPairs = mergedSymbols.get(filePath);
      if (!symbolPairs) { continue; }

      const symbolNodes: WalkthroughSymbolNode[] = [];
      for (const symbolName of [...symbolPairs.keys()].sort()) {
        const pair = symbolPairs.get(symbolName);
        if (!pair) { continue; }
        const manualBlocks = pair.manual
          ? await this.buildSourceBlocks(filePath, symbolName, pair.manual.blocks, 'manual')
          : [];
        const autoBlocks = pair.auto
          ? await this.buildSourceBlocks(filePath, symbolName, pair.auto.blocks, 'auto')
          : [];
        const blocks = [...manualBlocks, ...autoBlocks].map((block, blockIndex) => ({
          ...block,
          blockIndex,
          id: `${filePath}::${symbolName}::${blockIndex}`,
        }));
        const staleBlockCount = blocks.filter(block => block.stale).length;
        if (staleOnly && staleBlockCount === 0) {
          continue;
        }

        symbolNodes.push({
          kind: 'walkthrough-symbol',
          id: `${filePath}::${symbolName}`,
          filePath,
          symbolName,
          source: pair.manual ? 'manual' : 'auto',
          hasManual: !!pair.manual,
          hasAuto: !!pair.auto,
          staleBlockCount,
          children: blocks,
        });
      }

      if (symbolNodes.length === 0) {
        continue;
      }

      fileNodes.push({
        kind: 'walkthrough-file',
        id: filePath,
        filePath,
        staleSymbolCount: symbolNodes.filter(symbol => symbol.staleBlockCount > 0).length,
        manualSymbolCount: symbolNodes.filter(symbol => symbol.hasManual && !symbol.hasAuto).length,
        autoSymbolCount: symbolNodes.filter(symbol => !symbol.hasManual && symbol.hasAuto).length,
        mixedSymbolCount: symbolNodes.filter(symbol => symbol.hasManual && symbol.hasAuto).length,
        children: symbolNodes,
      });
    }

    return fileNodes;
  }

  private async buildUncoveredFiles(coveredFiles: Set<string>): Promise<UncoveredFileNode[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const config = loadConfig();
    const extensions = new Set(config.extensions.map(extension => extension.toLowerCase()));
    const skipPatterns = config.skipPatterns.map(pattern => new RegExp(pattern));
    const candidateFiles = await this.collectWorkspaceFiles(
      workspaceFolder.uri,
      workspaceFolder.uri.fsPath,
      extensions,
      skipPatterns,
    );

    return candidateFiles
      .filter(filePath => !coveredFiles.has(filePath))
      .sort((left, right) => left.localeCompare(right))
      .map(filePath => ({
        kind: 'uncovered-file',
        id: `uncovered::${filePath}`,
        filePath,
      }));
  }

  private toBlockNode(
    filePath: string,
    symbolName: string,
    block: CachedBlock,
    sourceBlockIndex: number,
    source: 'manual' | 'auto',
    stale: boolean,
  ): WalkthroughBlockNode {
    return {
      kind: 'walkthrough-block',
      id: `${filePath}::${symbolName}::${source}:${sourceBlockIndex}`,
      filePath,
      symbolName,
      blockIndex: sourceBlockIndex,
      sourceBlockIndex,
      label: block.label,
      startLine: block.startLine,
      endLine: block.endLine,
      description: block.description,
      source,
      stale,
    };
  }

  private async buildSourceBlocks(
    filePath: string,
    symbolName: string,
    blocks: CachedBlock[],
    source: 'manual' | 'auto',
  ): Promise<WalkthroughBlockNode[]> {
    const staleFlags = await this.computeStaleFlags(filePath, blocks);
    return blocks.map((block, blockIndex) => this.toBlockNode(
      filePath,
      symbolName,
      block,
      blockIndex,
      source,
      staleFlags[blockIndex] ?? false,
    ));
  }

  private async readTargets(): Promise<TargetStatusNode[]> {
    const groups = this.emptyTargetGroups();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return groups;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', 'targets.json');
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(fileUri);
    } catch {
      return groups;
    }

    let data: TargetsFile;
    try {
      data = JSON.parse(Buffer.from(raw).toString('utf-8'));
    } catch (error) {
      log('SidebarDataService.readTargets: invalid JSON', { error: String(error) });
      return groups;
    }

    const byStatus = new Map<SidebarTargetStatus, TargetEntryNode[]>();
    for (const status of ['pending', 'done', 'skip'] as const) {
      byStatus.set(status, []);
    }

    for (const target of data.targets ?? []) {
      const entries = byStatus.get(target.status);
      if (!entries) { continue; }
      entries.push({
        kind: 'target-entry',
        id: `${target.status}::${target.filePath}::${target.symbolName}`,
        filePath: target.filePath,
        symbolName: target.symbolName,
        targetKind: target.kind,
        line: target.line,
        endLine: target.endLine,
        level: target.level,
        status: target.status,
      });
    }

    return (['pending', 'done', 'skip'] as const).map(status => ({
      kind: 'target-status',
      id: `status::${status}`,
      status,
      children: (byStatus.get(status) ?? []).sort((left, right) => {
        if (left.filePath !== right.filePath) {
          return left.filePath.localeCompare(right.filePath);
        }
        return left.symbolName.localeCompare(right.symbolName);
      }),
    }));
  }

  private emptyTargetGroups(): TargetStatusNode[] {
    return (['pending', 'done', 'skip'] as const).map(status => ({
      kind: 'target-status',
      id: `status::${status}`,
      status,
      children: [],
    }));
  }

  private async readCacheExports(subDir: 'walks-manual' | 'walks-auto'): Promise<Map<string, CachedFileExport>> {
    const result = new Map<string, CachedFileExport>();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return result;
    }

    const rootUri = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', subDir);
    const fileUris = await this.collectJsonFiles(rootUri);
    for (const fileUri of fileUris) {
      try {
        const raw = await vscode.workspace.fs.readFile(fileUri);
        const data = JSON.parse(Buffer.from(raw).toString('utf-8')) as CachedFileExport;
        result.set(data.filePath, data);
      } catch (error) {
        log('SidebarDataService.readCacheExports: failed', { subDir, uri: fileUri.toString(), error: String(error) });
      }
    }
    return result;
  }

  private async collectJsonFiles(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }

    const files: vscode.Uri[] = [];
    for (const [name, fileType] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);
      if (fileType === vscode.FileType.Directory) {
        files.push(...await this.collectJsonFiles(childUri));
      } else if (fileType === vscode.FileType.File && name.endsWith('.json')) {
        files.push(childUri);
      }
    }
    return files;
  }

  private async collectWorkspaceFiles(
    dirUri: vscode.Uri,
    workspaceRootPath: string,
    extensions: Set<string>,
    skipPatterns: RegExp[],
  ): Promise<string[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const [name, fileType] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);
      const relativePath = path.relative(workspaceRootPath, childUri.fsPath).replace(/\\/g, '/');

      if (this.shouldSkipWorkspaceEntry(relativePath, fileType === vscode.FileType.Directory, skipPatterns)) {
        continue;
      }

      if (fileType === vscode.FileType.Directory) {
        files.push(...await this.collectWorkspaceFiles(childUri, workspaceRootPath, extensions, skipPatterns));
        continue;
      }

      if (fileType !== vscode.FileType.File) {
        continue;
      }

      if (!extensions.has(path.extname(name).toLowerCase())) {
        continue;
      }

      files.push(relativePath);
    }

    return files;
  }

  private shouldSkipWorkspaceEntry(relativePath: string, isDirectory: boolean, skipPatterns: RegExp[]): boolean {
    const normalizedPath = `/${relativePath}${isDirectory ? '/' : ''}`;
    if (relativePath.split('/').some(segment => segment.startsWith('.') && segment.length > 1)) {
      return true;
    }
    return skipPatterns.some(pattern => pattern.test(normalizedPath));
  }

  private async computeStaleFlags(filePath: string, blocks: CachedBlock[]): Promise<boolean[]> {
    const relevantBlocks = blocks.map(block => !!block.blockHash);
    if (!relevantBlocks.some(Boolean)) {
      return blocks.map(() => false);
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(resolveFileUri(filePath));
    } catch {
      return blocks.map(block => !!block.blockHash);
    }

    return blocks.map(block => {
      if (!block.blockHash) {
        return false;
      }
      const currentHash = this.computeDocumentBlockHash(document, block.startLine, block.endLine);
      return currentHash !== block.blockHash;
    });
  }

  private computeDocumentBlockHash(document: vscode.TextDocument, startLine: number, endLine: number): string {
    const lines: string[] = [];
    const startIndex = Math.max(0, startLine - 1);
    const endIndex = Math.min(document.lineCount - 1, endLine - 1);
    for (let lineIndex = startIndex; lineIndex <= endIndex; lineIndex++) {
      lines.push(document.lineAt(lineIndex).text);
    }
    const hash = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
    return `sha256:${hash}`;
  }
}