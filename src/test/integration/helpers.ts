/**
 * Integration テストのヘルパーユーティリティ
 *
 * 実際のテスト実装時にここに共通ヘルパーを追加する。
 * 例: ファイルを開く、キャッシュを準備する、BlockStore をリセットする等
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ── 拡張機能 exports 型定義 ──

export interface ExtBlockStore {
  clear(): void;
  setBlocks(uri: vscode.Uri, symbolName: string, blocks: unknown[], source?: string): void;
  setExplanation(uri: vscode.Uri, symbolName: string, blockIndex: number, explanation: string): void;
  getSymbolNames(uri: vscode.Uri): string[];
  getBlockDetails(uri: vscode.Uri, symbolName: string): Array<{
    block: { index: number; label: string; startLine: number; endLine: number; colorIndex: number; description?: string };
    source?: string;
    explanation?: string;
    hashMismatch?: boolean;
  }> | undefined;
  getBlockInfo(uri: vscode.Uri, symbolName: string, blockIndex: number): {
    index: number; label: string; startLine: number; endLine: number; colorIndex: number; description?: string;
  } | undefined;
  getBlockDescription(uri: vscode.Uri, symbolName: string, blockIndex: number): string | undefined;
  getExplanation(uri: vscode.Uri, symbolName: string, blockIndex: number): string | undefined;
  removeBlock(uri: vscode.Uri, symbolName: string, blockIndex: number): void;
  removeSymbol(uri: vscode.Uri, symbolName: string): void;
  clearUri(uri: vscode.Uri): void;
  setViewMode(mode: string): void;
  setHashMismatch(uri: vscode.Uri, symbolName: string, mismatch: boolean): void;
  setBlockHashMismatch(uri: vscode.Uri, symbolName: string, blockIndex: number, mismatch: boolean): void;
  adjustLineNumbers(uri: vscode.Uri, changeStart0: number, changeEnd0: number, delta: number): boolean;
  validateBlocks(uri: vscode.Uri): number;
  readonly viewMode: string;
  readonly onDidChange: vscode.Event<void>;
}

export interface ExtCacheService {
  hasWorkspace(): boolean;
  readFile(sub: string, cacheRelPath: string): Promise<unknown | null>;
  writeFile(sub: string, cacheRelPath: string, data: unknown): Promise<void>;
  deleteFile(sub: string, cacheRelPath: string): Promise<boolean>;
  deleteDir(sub: string, cacheRelPath: string): Promise<boolean>;
  deleteSubDir(sub: string): Promise<void>;
}

export interface ExtensionExports {
  blockStore: ExtBlockStore;
  codeLensProvider: vscode.CodeLensProvider;
  cacheService: ExtCacheService;
  restoreFromCache: (editor: vscode.TextEditor, blockStore: ExtBlockStore, cacheService: ExtCacheService) => Promise<boolean>;
  testHooks: {
    clearAllDecorations(): void;
    highlightBlocks(editor: vscode.TextEditor, blocks: Array<{ range: vscode.Range; colorIndex: number }>, symbolName?: string): void;
    setAnnotations(editor: vscode.TextEditor, annotations: Array<{ line: number; text: string }>, ownerKey?: string): void;
    clearSymbol(editor: vscode.TextEditor, symbolName: string): void;
    getStoredSymbolNames(uri: vscode.Uri): string[];
    getStoredAnnotationOwners(uri: vscode.Uri): string[];
    getCurrentAnnotationStyle(): 'italic' | 'normal' | undefined;
    getCurrentEditInitData(): {
      fileUri: vscode.Uri;
      symbolName: string;
      blockIndex: number;
      label: string;
      startLine: number;
      endLine: number;
      colorIndex: number;
      description: string;
      explanation: string;
      annotations: Array<{ line: number; text: string }>;
      isImport: boolean;
      source?: 'manual' | 'auto';
      sourceBlockIndex?: number;
    } | undefined;
    saveCurrentEditPanelForTest(message: {
      symbolName: string;
      label: string;
      startLine: number;
      endLine: number;
      colorIndex: number;
      description: string;
      explanation: string;
      annotations: Array<{ line: number; text: string }>;
    }): Promise<void>;
    disposeEditPanel(): void;
    getCurrentRepairPreviewData(): {
      filePath: string;
      symbolName: string;
      blockLabel: string;
      blockIndex: number;
      source: 'manual' | 'auto';
      oldStartLine: number;
      oldEndLine: number;
      codeStartLine: number;
      currentCode: string;
      candidates: Array<{
        id: string;
        strategy: 'definition-shift' | 'block-hash-match' | 'nearby-search';
        startLine: number;
        endLine: number;
        summary: string;
        reason: string;
        keepsExplanation: boolean;
        keepsAnnotations: boolean;
        canApply: boolean;
      }>;
      selectedCandidateId?: string;
    } | undefined;
    applyRepairPreviewCandidateForTest(candidateId?: string): Promise<void>;
    disposeRepairPreviewPanel(): void;
    navigateDetailPanelBlock(uri: vscode.Uri, symbolName: string, blockIndex: number): Promise<void>;
    restoreVisibleEditors(): Promise<void>;
    restoreEditorByUri(uri: vscode.Uri): Promise<void>;
    isRestoreTracked(uri: vscode.Uri): boolean;
    refreshSidebar(): Promise<void>;
    getSidebarSnapshot(): Promise<{
      walkthroughFiles: Array<{
        filePath: string;
        staleSymbolCount: number;
        manualSymbolCount: number;
        autoSymbolCount: number;
        mixedSymbolCount: number;
        children: Array<{
          symbolName: string;
          source: 'manual' | 'auto';
          hasManual: boolean;
          hasAuto: boolean;
          staleBlockCount: number;
          children: Array<{
            blockIndex: number;
            sourceBlockIndex: number;
            label: string;
            startLine: number;
            endLine: number;
            source: 'manual' | 'auto';
            stale: boolean;
          }>;
        }>;
      }>;
      uncoveredFiles: Array<{
        filePath: string;
      }>;
      staleFiles: Array<{
        filePath: string;
        staleSymbolCount: number;
        manualSymbolCount: number;
        autoSymbolCount: number;
        mixedSymbolCount: number;
        children: Array<{
          symbolName: string;
          staleBlockCount: number;
          children: Array<{
            blockIndex: number;
            sourceBlockIndex: number;
            label: string;
            source: 'manual' | 'auto';
            stale: boolean;
          }>;
        }>;
      }>;
      targetGroups: Array<{
        status: 'pending' | 'done' | 'skip';
        children: Array<{
          filePath: string;
          symbolName: string;
          line: number;
          status: 'pending' | 'done' | 'skip';
        }>;
      }>;
    }>;
    getGraphSnapshot(): Promise<{
      nodes: Array<{
        id: string;
        kind: 'file' | 'symbol' | 'block';
        status: 'manual' | 'auto' | 'mixed' | 'stale' | 'none';
        label: string;
        filePath: string;
        symbolName?: string;
        blockIndex?: number;
      }>;
      edges: Array<{
        id: string;
        from: string;
        to: string;
        kind: 'contains' | 'imports' | 'references';
      }>;
    }>;
    getTimelineData(snapshotRoots?: vscode.Uri[]): Promise<{
      snapshots: Array<{
        id: string;
        label: string;
        rootPath: string;
        symbolCount: number;
        manualCount: number;
        autoCount: number;
        staleCount: number;
      }>;
      symbols: Array<{
        key: string;
        filePath: string;
        symbolName: string;
        points: Array<{
          snapshotId: string;
          source: 'manual' | 'auto' | 'none';
          blockCount: number;
          stale: boolean;
          changeMagnitude: number;
        }>;
      }>;
    }>;
  };
}

/**
 * 指定したワークスペース相対パスのファイルをエディタで開く
 */
export async function openFile(relativePath: string): Promise<vscode.TextEditor> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }
  const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, relativePath));
  const doc = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(doc);
}

/**
 * 全エディタを閉じる
 */
export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/**
 * ワークスペースの .code-walker/ ディレクトリをクリーンアップ
 */
export function cleanCodeWalkerCache(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }
  const cacheDir = path.join(workspaceFolder.uri.fsPath, '.code-walker');
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  // デバッグログも削除
  const debugLog = path.join(workspaceFolder.uri.fsPath, '.code-walker-debug.log');
  if (fs.existsSync(debugLog)) {
    fs.unlinkSync(debugLog);
  }
}

/**
 * 指定ミリ秒待つ
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 拡張機能がアクティブになるのを待つ
 */
export async function waitForExtensionActivation(): Promise<vscode.Extension<unknown> | undefined> {
  const ext = vscode.extensions.getExtension('Taogya.code-walker');
  if (ext && !ext.isActive) {
    await ext.activate();
  }
  return ext;
}

/**
 * 拡張機能 exports を取得する
 */
export async function getExtensionExports(): Promise<ExtensionExports> {
  const ext = vscode.extensions.all.find(e =>
    e.id.includes('code-walker') || e.id.includes('CodeWalker')
  );
  if (!ext) { throw new Error('CodeWalker extension not found'); }
  if (!ext.isActive) { await ext.activate(); }
  return ext.exports as ExtensionExports;
}

export function patchWindowMethod<T extends keyof typeof vscode.window>(
  methodName: T,
  value: unknown,
): () => void {
  const target = vscode.window as typeof vscode.window & Record<string, unknown>;
  const original = target[methodName as string] as (typeof vscode.window)[T];
  Object.defineProperty(target, methodName, {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(target, methodName, {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
