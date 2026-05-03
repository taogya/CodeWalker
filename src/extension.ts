/**
 * extension.ts — CodeWalker エントリポイント
 *
 * BlockStore / CacheService の生成、ツール・コマンドの登録、
 * キャッシュ復元ライフサイクルを管理する。
 * 各コマンドの実装は src/commands/ に委譲。
 *
 * A-1 リファクタリング: 肥大化した entry point を ~110 行に縮小。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';

// ── コア ───────────────────────────────────────
import { BlockStore } from '@walker/blockStore';
import { WalkerCodeLensProvider } from '@walker/codeLensProvider';
import { CacheService } from '@cache/cacheService';

// ── ツール ─────────────────────────────────────
import { AnalyzeTool } from '@tools/analyzeTool';
import { DrilldownTool } from '@tools/drilldownTool';
import { HighlightTool } from '@tools/highlightTool';
import { ExportTool } from '@tools/exportTool';
import { FindSymbolTool } from '@tools/findSymbolTool';
import { ListSymbolsTool } from '@tools/listSymbolsTool';

// ── コマンド ───────────────────────────────────
import {
  clearHighlightsCommand,
  showBlockDetailCommand,
  toggleAnnotationsCommand,
  clearCacheCommand,
  addBlockCommand,
  editBlockCommand,
  deleteBlockCommand,
  repairWalkthroughCommand,
  setViewModeCommand,
  updateStatusBar,
  compareWalkthroughsCommand,
  disposeComparePanel,
  buildSymbolGraphSnapshot,
  buildTimelineData,
  disposeSymbolGraphPanel,
  disposeTimelinePanel,
  openSymbolGraphCommand,
  openTimelineCommand,
} from '@commands';

// ── ユーティリティ ─────────────────────────────
import {
  disposeDecorations,
  clearAll as clearAllHighlighter,
  clearSymbol,
  clearUri as clearHighlighterUri,
  hasStoredDecorations,
  highlightBlocks,
  reapplyDecorations,
  refreshAnnotationDecorations,
  setAnnotations,
  adjustStoredLines,
  __getCurrentAnnotationStyle,
  __getStoredAnnotationOwners,
  __getStoredSymbolNames,
  type BlockRange,
  type LineAnnotation,
} from '@walker/highlighter';
import { disposeBlockDetailPanel, setDetailPanelExtensionUri, setDetailPanelNavCallback } from '@walker/blockDetailPanel';
import {
  __getCurrentEditInitData,
  __saveCurrentEditPanelForTest,
  disposeBlockEditPanel,
  type BlockEditInitData,
} from '@walker/blockEditPanel';
import {
  __applyRepairPreviewCandidateForTest,
  __getCurrentRepairPreviewData,
  disposeRepairPreviewPanel,
  type RepairPreviewData,
} from '@walker/repairPreviewPanel';
import { restoreFromCache } from '@cache/restoreCache';
import { loadConfig } from '@cache/configReader';
import {
  clearSidebarNodeCacheCommand,
  exportSidebarNodeCommand,
  openSidebarNodeCommand,
  openTargetsFileCommand,
  repairSidebarNodeCommand,
  showSidebarNodeDetailCommand,
} from '@sidebar/sidebarCommands';
import { SidebarDataService } from '@sidebar/sidebarDataService';
import { BatchTargetsTreeProvider, UncoveredFilesTreeProvider, WalkthroughTreeProvider } from '@sidebar/sidebarProviders';
import type { SidebarSnapshot } from '@sidebar/types';
import { initLogger, log } from '@utils/logger';
import { notifyError, notifyInfo, notifyWarning } from '@utils/notifications';

/** BlockStore シングルトン（ツールからの DI 用に公開） */
export let blockStore: BlockStore;

/** テスト・外部拡張用エクスポート型 */
export interface ExtensionExports {
  blockStore: BlockStore;
  codeLensProvider: WalkerCodeLensProvider;
  cacheService: CacheService;
  restoreFromCache: typeof restoreFromCache;
  testHooks: {
    clearAllDecorations: () => void;
    highlightBlocks: (editor: vscode.TextEditor, blocks: BlockRange[], symbolName?: string) => void;
    setAnnotations: (editor: vscode.TextEditor, annotations: LineAnnotation[], ownerKey?: string) => void;
    clearSymbol: (editor: vscode.TextEditor, symbolName: string) => void;
    getStoredSymbolNames: (uri: vscode.Uri) => string[];
    getStoredAnnotationOwners: (uri: vscode.Uri) => string[];
    getCurrentAnnotationStyle: () => 'italic' | 'normal' | undefined;
    getCurrentEditInitData: () => BlockEditInitData | undefined;
    saveCurrentEditPanelForTest: (message: {
      symbolName: string;
      label: string;
      startLine: number;
      endLine: number;
      colorIndex: number;
      description: string;
      explanation: string;
      annotations: Array<{ line: number; text: string }>;
    }) => Promise<void>;
    disposeEditPanel: () => void;
    getCurrentRepairPreviewData: () => RepairPreviewData | undefined;
    applyRepairPreviewCandidateForTest: (candidateId?: string) => Promise<void>;
    disposeRepairPreviewPanel: () => void;
    navigateDetailPanelBlock: (uri: vscode.Uri, symbolName: string, blockIndex: number) => Promise<void>;
    restoreVisibleEditors: () => Promise<void>;
    restoreEditorByUri: (uri: vscode.Uri) => Promise<void>;
    isRestoreTracked: (uri: vscode.Uri) => boolean;
    refreshSidebar: () => Promise<void>;
    getSidebarSnapshot: () => Promise<SidebarSnapshot>;
    getGraphSnapshot: () => Promise<ReturnType<typeof buildSymbolGraphSnapshot> extends Promise<infer T> ? T : never>;
    getTimelineData: (snapshotRoots?: vscode.Uri[]) => Promise<ReturnType<typeof buildTimelineData> extends Promise<infer T> ? T : never>;
  };
}

async function navigateBlockDetail(
  blockStore: BlockStore,
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
): Promise<void> {
  await showBlockDetailCommand(blockStore, uri, symbolName, blockIndex, {
    revealEditor: true,
    preserveEditorFocus: true,
    revealType: vscode.TextEditorRevealType.InCenter,
  });
}

export function activate(context: vscode.ExtensionContext): ExtensionExports {
  initLogger(context);
  log('activate() called');

  // ── コア生成 ─────────────────────────────────
  const config = loadConfig();
  blockStore = new BlockStore();
  blockStore.setViewMode(config.viewMode);
  const cacheService = new CacheService();
  const codeLensProvider = new WalkerCodeLensProvider(blockStore);
  const sidebarDataService = new SidebarDataService(cacheService);
  const walkthroughTreeProvider = new WalkthroughTreeProvider(sidebarDataService, 'walkthrough');
  const uncoveredFilesTreeProvider = new UncoveredFilesTreeProvider(sidebarDataService);
  const staleTreeProvider = new WalkthroughTreeProvider(sidebarDataService, 'stale');
  const targetsTreeProvider = new BatchTargetsTreeProvider(sidebarDataService);
  const extensionUri = context.extensionUri;

  // Webview 用 extensionUri セット
  setDetailPanelExtensionUri(extensionUri);
  setDetailPanelNavCallback((uriString, symbolName, blockIndex) => {
    const uri = vscode.Uri.parse(uriString);
    void navigateBlockDetail(blockStore, uri, symbolName, blockIndex);
  });

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
    vscode.window.createTreeView('codeWalker.walkthroughExplorer', { treeDataProvider: walkthroughTreeProvider }),
    vscode.window.createTreeView('codeWalker.uncoveredFiles', { treeDataProvider: uncoveredFilesTreeProvider }),
    vscode.window.createTreeView('codeWalker.staleQueue', { treeDataProvider: staleTreeProvider }),
    vscode.window.createTreeView('codeWalker.batchTargets', { treeDataProvider: targetsTreeProvider }),
  );

  // ── Agent Mode ツール登録 ─────────────────────
  try {
    context.subscriptions.push(
      vscode.lm.registerTool('code_walker_analyze', new AnalyzeTool(context, cacheService, blockStore)),
      vscode.lm.registerTool('code_walker_drilldown', new DrilldownTool(context)),
      vscode.lm.registerTool('code_walker_highlight', new HighlightTool(context, blockStore)),
      vscode.lm.registerTool('code_walker_export', new ExportTool(context, cacheService, blockStore)),
      vscode.lm.registerTool('code_walker_find_symbol', new FindSymbolTool()),
      vscode.lm.registerTool('code_walker_list_symbols', new ListSymbolsTool()),
    );
    log('All 6 tools registered successfully');
  } catch (err) {
    log('Tool registration FAILED', { error: String(err), stack: (err as Error).stack });
    void notifyError(`CodeWalker: Tool registration failed — ${err}`);
  }

  // ── ステータスバー（ViewMode 表示）──────────
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codeWalker.setViewMode';
  updateStatusBar(statusBarItem, blockStore.viewMode);
  context.subscriptions.push(statusBarItem);

  // ── コマンド登録 ──────────────────────────────
  const restoredUris = new Set<string>();
  const restoringUris = new Set<string>();

  context.subscriptions.push(
    vscode.commands.registerCommand('codeWalker.clearHighlights', () =>
      clearHighlightsCommand(blockStore, restoredUris)),

    vscode.commands.registerCommand('codeWalker.showBlockDetail',
      (uri: vscode.Uri, sym: string, idx: number) =>
        showBlockDetailCommand(blockStore, uri, sym, idx)),

    vscode.commands.registerCommand('codeWalker.toggleAnnotations', () =>
      toggleAnnotationsCommand()),

    vscode.commands.registerCommand('codeWalker.clearCache', () =>
      clearCacheCommand(blockStore, cacheService, restoredUris)),

    vscode.commands.registerCommand('codeWalker.addBlock', () =>
      addBlockCommand(blockStore, cacheService, extensionUri, restoredUris)),

    vscode.commands.registerCommand('codeWalker.editBlock',
      (uri: vscode.Uri, sym: string, idx: number, isImport?: boolean) =>
        editBlockCommand(blockStore, cacheService, extensionUri, restoredUris, uri, sym, idx, isImport)),

    vscode.commands.registerCommand('codeWalker.deleteBlock',
      (uri: vscode.Uri, sym: string, idx: number) =>
        deleteBlockCommand(blockStore, cacheService, uri, sym, idx)),

    vscode.commands.registerCommand('codeWalker.repairWalkthrough',
      (uri?: vscode.Uri, sym?: string, idx?: number) =>
        repairWalkthroughCommand(
          blockStore,
          cacheService,
          extensionUri,
          restoredUris,
          restoreFromCache,
          () => sidebarDataService.refresh(),
          uri,
          sym,
          idx,
        )),

    vscode.commands.registerCommand('codeWalker.setViewMode', () =>
      setViewModeCommand(blockStore, statusBarItem)),

    vscode.commands.registerCommand('codeWalker.compareWalkthroughs', () =>
      compareWalkthroughsCommand(extensionUri)),

    vscode.commands.registerCommand('codeWalker.openSymbolGraph', () =>
      openSymbolGraphCommand(extensionUri, sidebarDataService, cacheService, blockStore, restoreFromCache)),

    vscode.commands.registerCommand('codeWalker.openTimeline', (options?: { snapshotRoots?: vscode.Uri[] } | vscode.Uri[]) =>
      openTimelineCommand(extensionUri, blockStore, cacheService, restoreFromCache, options)),

    vscode.commands.registerCommand('codeWalker.sidebar.refresh', async () =>
      sidebarDataService.refresh()),

    vscode.commands.registerCommand('codeWalker.sidebar.openNode', (node) =>
      openSidebarNodeCommand(node)),

    vscode.commands.registerCommand('codeWalker.sidebar.showNodeDetail', (node) =>
      showSidebarNodeDetailCommand(node, blockStore, cacheService, restoreFromCache)),

    vscode.commands.registerCommand('codeWalker.sidebar.exportNode', (node) =>
      exportSidebarNodeCommand(node, cacheService)),

    vscode.commands.registerCommand('codeWalker.sidebar.clearNodeCache', (node) =>
      clearSidebarNodeCacheCommand(node, blockStore, cacheService, restoredUris, () => sidebarDataService.refresh())),

    vscode.commands.registerCommand('codeWalker.sidebar.repairNode', (node) =>
      repairSidebarNodeCommand(
        node,
        blockStore,
        cacheService,
        extensionUri,
        restoredUris,
        restoreFromCache,
        () => sidebarDataService.refresh(),
      )),

    vscode.commands.registerCommand('codeWalker.sidebar.openTargetsFile', () =>
      openTargetsFileCommand()),
  );

  void notifyInfo('CodeWalker: Extension activated — 6 tools + CodeLens registered');
  log('activate() completed');

  // ── キャッシュ復元ライフサイクル ──────────────
  const restoreEditor = async (editor: vscode.TextEditor | undefined) => {
    if (!editor || editor.document.uri.scheme !== 'file') {
      log('restoreEditor: skipped', { hasEditor: !!editor, scheme: editor?.document.uri.scheme });
      return;
    }
    const key = editor.document.uri.toString();
    const hasDisplayState = hasStoredDecorations(editor.document.uri)
      || blockStore.getSymbolNames(editor.document.uri).length > 0;
    if (restoredUris.has(key) && !hasDisplayState) {
      restoredUris.delete(key);
      log('restoreEditor: stale restore state cleared', { uri: key });
    }
    if (restoredUris.has(key)) {
      log('restoreEditor: already restored', { uri: key });
      if (hasDisplayState) {
        reapplyDecorations(editor);
      }
      return;
    }
    if (restoringUris.has(key)) {
      log('restoreEditor: restore already in progress', { uri: key });
      if (hasDisplayState) {
        reapplyDecorations(editor);
      }
      return;
    }

    restoringUris.add(key);
    try {
      log('restoreEditor: attempting restore', { uri: key });
      const restored = await restoreFromCache(editor, blockStore, cacheService);
      if (restored) {
        restoredUris.add(key);
        log('restoreEditor: cache restored', { uri: key });
      } else {
        restoredUris.delete(key);
        log('restoreEditor: no cache to restore', { uri: key });
      }
    } catch (err) {
      restoredUris.delete(key);
      log('restoreEditor: FAILED', { error: String(err), stack: (err as Error).stack, uri: key });
    } finally {
      restoringUris.delete(key);
      if (hasStoredDecorations(editor.document.uri)) {
        reapplyDecorations(editor);
      }
    }
  };

  for (const editor of vscode.window.visibleTextEditors) {
    void restoreEditor(editor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      log('onDidChangeActiveTextEditor', { uri: editor?.document.uri.toString(), scheme: editor?.document.uri.scheme });
      void restoreEditor(editor);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') {
        return;
      }
      for (const editor of vscode.window.visibleTextEditors.filter(visibleEditor => visibleEditor.document.uri.toString() === doc.uri.toString())) {
        void restoreEditor(editor);
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        void restoreEditor(editor);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeWalker.annotationStyle')) {
        refreshAnnotationDecorations();
      }
      if (
        event.affectsConfiguration('codeWalker.annotationStyle') ||
        event.affectsConfiguration('codeWalker.viewMode') ||
        event.affectsConfiguration('codeWalker.defaultColor')
      ) {
        sidebarDataService.invalidate();
      }
    }),
  );

  context.subscriptions.push(
    blockStore.onDidChange(() => {
      sidebarDataService.invalidate();
    }),
  );

  // ファイルクローズ時に復元フラグをクリア（再オープン時に復元を再実行するため）
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      if (vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === key)) {
        log('Document close ignored because another visible editor still exists', { uri: key });
        return;
      }
      restoringUris.delete(key);
      const hadRestoreState = restoredUris.delete(key);
      const hasDisplayState = hadRestoreState
        || hasStoredDecorations(doc.uri)
        || blockStore.getSymbolNames(doc.uri).length > 0;
      if (hasDisplayState) {
        clearHighlighterUri(key);
        blockStore.clearUri(doc.uri);
        sidebarDataService.invalidate();
        log('Document closed, cleared restore state', { uri: key });
      }
    }),
  );

  // C2: テキスト編集時の行番号自動追従
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) { return; }
      const uri = e.document.uri;
      if (!blockStore.getSymbolNames(uri).length) { return; }

      const lineTrackingEnabled = vscode.workspace
        .getConfiguration('codeWalker')
        .get<boolean>('enableLineTracking', true);
      if (!lineTrackingEnabled) { return; }

      // 変更を下から上に処理（上の変更が下の行番号に影響しないように）
      const sorted = [...e.contentChanges].sort(
        (a, b) => b.range.start.line - a.range.start.line,
      );

      for (const change of sorted) {
        const changeStart = change.range.start.line;
        const changeEnd = change.range.end.line;
        const deletedLines = changeEnd - changeStart;
        const insertedLines = (change.text.match(/\n/g) || []).length;
        const delta = insertedLines - deletedLines;

        if (delta !== 0) {
          blockStore.adjustLineNumbers(uri, changeStart, changeEnd, delta);
          adjustStoredLines(uri.toString(), changeStart, changeEnd, delta);
        }
      }
    }),
  );

  // C2-F: 保存時にブロック整合性を検証し、壊れたブロックに ⚠ を付与
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!blockStore.getSymbolNames(doc.uri).length) { return; }

      const lineTrackingEnabled = vscode.workspace
        .getConfiguration('codeWalker')
        .get<boolean>('enableLineTracking', true);
      if (!lineTrackingEnabled) { return; }

      const warnCount = blockStore.validateBlocks(doc.uri);
      if (warnCount > 0) {
        void notifyWarning(
          l10n.t('{0} broken block(s) detected. Re-analyze recommended.', String(warnCount)),
        );
      }
      sidebarDataService.invalidate();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => {
      sidebarDataService.invalidate();
    }),
    vscode.workspace.onDidDeleteFiles(() => {
      sidebarDataService.invalidate();
    }),
    vscode.workspace.onDidRenameFiles(() => {
      sidebarDataService.invalidate();
    }),
  );

  void sidebarDataService.refresh().catch((error) => {
    log('Sidebar refresh failed during activation', { error: String(error) });
  });

  // テスト・外部拡張用にエクスポート
  return {
    blockStore,
    codeLensProvider,
    cacheService,
    restoreFromCache,
    testHooks: {
      clearAllDecorations: clearAllHighlighter,
      highlightBlocks,
      setAnnotations,
      clearSymbol,
      getStoredSymbolNames: __getStoredSymbolNames,
      getStoredAnnotationOwners: __getStoredAnnotationOwners,
      getCurrentAnnotationStyle: __getCurrentAnnotationStyle,
      getCurrentEditInitData: __getCurrentEditInitData,
      saveCurrentEditPanelForTest: __saveCurrentEditPanelForTest,
      disposeEditPanel: disposeBlockEditPanel,
      getCurrentRepairPreviewData: __getCurrentRepairPreviewData,
      applyRepairPreviewCandidateForTest: __applyRepairPreviewCandidateForTest,
      disposeRepairPreviewPanel,
      navigateDetailPanelBlock: (uri: vscode.Uri, symbolName: string, blockIndex: number) =>
        navigateBlockDetail(blockStore, uri, symbolName, blockIndex),
      restoreVisibleEditors: async () => {
        await Promise.all(vscode.window.visibleTextEditors.map(editor => restoreEditor(editor)));
      },
      restoreEditorByUri: async (uri: vscode.Uri) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
        await restoreEditor(editor);
      },
      isRestoreTracked: (uri: vscode.Uri) => restoredUris.has(uri.toString()),
      refreshSidebar: () => sidebarDataService.refresh(),
      getSidebarSnapshot: () => sidebarDataService.getSnapshot(),
      getGraphSnapshot: () => buildSymbolGraphSnapshot(sidebarDataService, cacheService),
      getTimelineData: (snapshotRoots?: vscode.Uri[]) => buildTimelineData(snapshotRoots),
    },
  };
}

export function deactivate(): void {
  log('deactivate() called');
  blockStore?.dispose();
  disposeDecorations();
  disposeBlockDetailPanel();
  disposeBlockEditPanel();
  disposeRepairPreviewPanel();
  disposeComparePanel();
  disposeSymbolGraphPanel();
  disposeTimelinePanel();
  log('deactivate() completed');
}
