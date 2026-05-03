import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { CacheSubDir, CacheService } from '@cache/cacheService';
import type { CachedBlock, CachedSymbolEntry } from '@cache/cacheTypes';
import type { BlockStore } from '@walker/blockStore';
import { editBlockCommand } from '@commands/editBlock';
import { showBlockDetailCommand } from '@commands/showBlockDetail';
import { findSymbol } from '@walker/symbolFinder';
import { showRepairPreviewPanel, type RepairPreviewCandidate, type RepairPreviewData } from '@walker/repairPreviewPanel';
import { clearSymbolByUri, clearUri as clearHighlighterUri } from '@walker/highlighter';
import { computeBlockHash, lineRange, openFileInEditor, resolveFileUri, toCacheRelPath } from '@utils/fileUtils';
import { notifyInfo, notifyWarning } from '@utils/notifications';
import { buildWalkthroughMarkdown } from '@utils/walkthroughMarkdown';
import type { SidebarNode, TargetEntryNode, WalkthroughBlockNode, WalkthroughFileNode, WalkthroughSymbolNode } from './types';

export async function openSidebarNodeCommand(node: SidebarNode): Promise<void> {
  if (node.kind === 'target-status') {
    return;
  }

  const uri = resolveFileUri(node.filePath);
  const editor = await openFileInEditor(uri);

  if (node.kind === 'uncovered-file' || node.kind === 'walkthrough-file') {
    return;
  }

  if (node.kind === 'walkthrough-symbol') {
    const firstBlock = node.children[0];
    if (firstBlock) {
      editor.revealRange(lineRange(editor.document, firstBlock.startLine, firstBlock.endLine), vscode.TextEditorRevealType.InCenter);
    }
    return;
  }

  if (node.kind === 'walkthrough-block') {
    editor.revealRange(lineRange(editor.document, node.startLine, node.endLine), vscode.TextEditorRevealType.InCenter);
    return;
  }

  if (node.kind === 'target-entry') {
    editor.revealRange(lineRange(editor.document, node.line, node.endLine ?? node.line), vscode.TextEditorRevealType.InCenter);
  }
}

export async function showSidebarNodeDetailCommand(
  node: SidebarNode,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
): Promise<void> {
  const blockNode = toBlockNode(node);
  if (!blockNode) {
    await openSidebarNodeCommand(node);
    return;
  }

  const uri = resolveFileUri(blockNode.filePath);
  const editor = await openFileInEditor(uri);
  await restoreFromCache(editor, blockStore, cacheService);
  await showBlockDetailCommand(blockStore, uri, blockNode.symbolName, blockNode.blockIndex);
}

export async function openTargetsFileCommand(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    void notifyWarning(l10n.t('CodeWalker: No workspace is open.'));
    return;
  }

  const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', 'targets.json');
  try {
    await openFileInEditor(uri, { preserveFocus: false });
  } catch {
    void notifyInfo(l10n.t('CodeWalker: .code-walker/targets.json was not found.'));
  }
}

export async function exportSidebarNodeCommand(
  node: SidebarNode,
  cacheService: CacheService,
): Promise<void> {
  const symbolTarget = toSymbolTarget(node);
  if (!symbolTarget) {
    void notifyWarning(l10n.t('CodeWalker: Export is available for symbol or block nodes only.'));
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    void notifyWarning(l10n.t('CodeWalker: No workspace is open.'));
    return;
  }

  const resolved = await resolveSymbolCache(cacheService, symbolTarget.filePath, symbolTarget.symbolName);
  if (!resolved) {
    void notifyWarning(l10n.t('CodeWalker: No walkthrough cache found for "{0}".', symbolTarget.symbolName));
    return;
  }

  const cacheRelPath = toCacheRelPath(symbolTarget.filePath);
  const exportDir = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', resolved.subDir, cacheRelPath);
  await vscode.workspace.fs.createDirectory(exportDir);

  const markdown = buildWalkthroughMarkdown(
    symbolTarget.filePath,
    symbolTarget.symbolName,
    resolved.entry.overview,
    resolved.entry.blocks.map(block => ({
      label: block.label,
      startLine: block.startLine,
      endLine: block.endLine,
      description: block.description,
      explanation: block.explanation,
      annotations: block.annotations,
    })),
  );

  const mdUri = vscode.Uri.joinPath(exportDir, `${symbolTarget.symbolName}.md`);
  await vscode.workspace.fs.writeFile(mdUri, Buffer.from(markdown, 'utf-8'));
  void notifyInfo(l10n.t('CodeWalker: Markdown exported for "{0}".', symbolTarget.symbolName));
}

export async function clearSidebarNodeCacheCommand(
  node: SidebarNode,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
  refreshSidebar: () => Promise<void>,
): Promise<void> {
  if (node.kind === 'walkthrough-file') {
    await clearFileNodeCache(node.filePath, blockStore, cacheService, restoredUris);
    await refreshSidebar();
    return;
  }

  if (node.kind === 'walkthrough-symbol') {
    await clearSymbolNodeCache(node.filePath, node.symbolName, blockStore, cacheService, restoredUris);
    await refreshSidebar();
    return;
  }

  void notifyWarning(l10n.t('CodeWalker: Clear cache is available for file or symbol nodes only.'));
}

export async function repairSidebarNodeCommand(
  node: SidebarNode,
  blockStore: BlockStore,
  cacheService: CacheService,
  extensionUri: vscode.Uri,
  restoredUris: Set<string>,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  refreshSidebar: () => Promise<void>,
): Promise<void> {
  const target = await pickRepairTarget(node);
  if (!target) {
    void notifyInfo(l10n.t('CodeWalker: No stale walkthrough block found.'));
    return;
  }

  const uri = resolveFileUri(target.filePath);
  const editor = await openFileInEditor(uri);
  if (await tryAutoShiftRepair(
    target,
    editor,
    blockStore,
    cacheService,
    restoredUris,
    restoreFromCache,
    refreshSidebar,
  )) {
    return;
  }

  const preview = await buildRepairPreviewContext(target, editor.document, cacheService);
  if (preview) {
    showRepairPreviewPanel(preview.data, {
      onApplyCandidate: async (candidateId) => {
        const selected = preview.candidates.get(candidateId);
        if (!selected?.repairedEntry) {
          return;
        }
        await applyRepairEntry(
          target,
          editor,
          blockStore,
          cacheService,
          restoredUris,
          restoreFromCache,
          refreshSidebar,
          preview.subDir,
          selected.repairedEntry,
        );

        const repairedBlock = selected.repairedEntry.blocks[target.sourceBlockIndex];
        if (repairedBlock) {
          void notifyInfo(
            l10n.t(
              'CodeWalker: Applied repair candidate for "{0}" at L{1}-L{2}.',
              target.symbolName,
              repairedBlock.startLine,
              repairedBlock.endLine,
            ),
          );
        }
      },
      onOpenCandidate: async (candidateId) => {
        const selected = preview.candidates.get(candidateId)?.candidate;
        if (!selected) {
          return;
        }
        editor.revealRange(
          lineRange(editor.document, selected.startLine, selected.endLine),
          vscode.TextEditorRevealType.InCenter,
        );
      },
      onOpenEdit: async () => {
        await restoreFromCache(editor, blockStore, cacheService);
        await editBlockCommand(
          blockStore,
          cacheService,
          extensionUri,
          restoredUris,
          uri,
          target.symbolName,
          target.blockIndex,
          target.source === 'auto',
        );
      },
    });
    return;
  }

  await restoreFromCache(editor, blockStore, cacheService);
  await editBlockCommand(
    blockStore,
    cacheService,
    extensionUri,
    restoredUris,
    uri,
    target.symbolName,
    target.blockIndex,
    target.source === 'auto',
  );
}

type RepairSuggestion =
  | {
    kind: 'definition-shift';
    delta: number;
    repairedEntry: CachedSymbolEntry;
  }
  | {
    kind: 'block-hash-match';
    repairedEntry: CachedSymbolEntry;
  };

interface RepairPreviewCandidateEntry {
  candidate: RepairPreviewCandidate;
  repairedEntry?: CachedSymbolEntry;
}

interface RepairPreviewContext {
  data: RepairPreviewData;
  candidates: Map<string, RepairPreviewCandidateEntry>;
  subDir: CacheSubDir;
}

function toBlockNode(node: SidebarNode): WalkthroughBlockNode | undefined {
  if (node.kind === 'walkthrough-block') {
    return node;
  }
  if (node.kind === 'walkthrough-symbol') {
    return node.children[0];
  }
  return undefined;
}

function toSymbolTarget(node: SidebarNode): { filePath: string; symbolName: string } | undefined {
  if (node.kind === 'walkthrough-symbol' || node.kind === 'walkthrough-block') {
    return {
      filePath: node.filePath,
      symbolName: node.symbolName,
    };
  }
  return undefined;
}

async function resolveSymbolCache(
  cacheService: CacheService,
  filePath: string,
  symbolName: string,
): Promise<{ entry: CachedSymbolEntry; subDir: CacheSubDir } | undefined> {
  const cacheRelPath = toCacheRelPath(filePath);
  for (const subDir of ['walks-manual', 'walks-auto'] as const) {
    const data = await cacheService.readFile(subDir, cacheRelPath);
    const entry = data?.symbols[symbolName];
    if (entry) {
      return { entry, subDir };
    }
  }
  return undefined;
}

async function tryAutoShiftRepair(
  target: WalkthroughBlockNode,
  editor: vscode.TextEditor,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  refreshSidebar: () => Promise<void>,
): Promise<boolean> {
  const resolved = await resolveSymbolCache(cacheService, target.filePath, target.symbolName);
  if (!resolved) {
    return false;
  }

  const suggestion = await buildShiftRepairSuggestion(
    editor.document.uri,
    target.symbolName,
    target.sourceBlockIndex,
    resolved.entry,
    editor.document.lineCount,
  ) ?? await buildBlockHashRepairSuggestion(
    editor.document,
    target.symbolName,
    target.sourceBlockIndex,
    resolved.entry,
  );
  if (!suggestion) {
    return false;
  }

  if (!await applyRepairEntry(
    target,
    editor,
    blockStore,
    cacheService,
    restoredUris,
    restoreFromCache,
    refreshSidebar,
    resolved.subDir,
    suggestion.repairedEntry,
  )) {
    return false;
  }

  const repairedBlock = suggestion.repairedEntry.blocks[target.sourceBlockIndex];

  if (suggestion.kind === 'definition-shift') {
    void notifyInfo(
      l10n.t(
        'CodeWalker: Repaired "{0}" by shifting {1} lines.',
        target.symbolName,
        formatSignedLineDelta(suggestion.delta),
      ),
    );
  } else if (repairedBlock) {
    void notifyInfo(
      l10n.t(
        'CodeWalker: Repaired block "{0}" in "{1}" at L{2}-L{3}.',
        target.label,
        target.symbolName,
        repairedBlock.startLine,
        repairedBlock.endLine,
      ),
    );
  }
  return true;
}

async function applyRepairEntry(
  target: WalkthroughBlockNode,
  editor: vscode.TextEditor,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  refreshSidebar: () => Promise<void>,
  subDir: CacheSubDir,
  repairedEntry: CachedSymbolEntry,
): Promise<boolean> {
  const cacheRelPath = toCacheRelPath(target.filePath);
  const data = await cacheService.readFile(subDir, cacheRelPath);
  if (!data?.symbols[target.symbolName]) {
    return false;
  }

  data.symbols[target.symbolName] = repairedEntry;
  await cacheService.writeFile(subDir, cacheRelPath, data);

  const uri = editor.document.uri;
  clearHighlighterUri(uri.toString());
  blockStore.clearUri(uri);
  restoredUris.delete(uri.toString());
  await restoreFromCache(editor, blockStore, cacheService);
  restoredUris.add(uri.toString());
  await refreshSidebar();

  const repairedBlock = repairedEntry.blocks[target.sourceBlockIndex];
  if (repairedBlock) {
    editor.revealRange(
      lineRange(editor.document, repairedBlock.startLine, repairedBlock.endLine),
      vscode.TextEditorRevealType.InCenter,
    );
  }
  return true;
}

async function buildShiftRepairSuggestion(
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
  entry: CachedSymbolEntry,
  lineCount: number,
): Promise<RepairSuggestion | undefined> {
  if (symbolName === '📄' || entry.blocks.length === 0) {
    return undefined;
  }

  const symbol = await findSymbolWithRetry(uri, symbolName);
  if (!symbol) {
    return undefined;
  }

  const anchorStartLine = Math.min(...entry.blocks.map(block => block.startLine));
  const delta = symbol.range.start.line + 1 - anchorStartLine;
  if (delta === 0) {
    return undefined;
  }

  const repairedBlocks: CachedBlock[] = [];
  for (const block of entry.blocks) {
    const shifted = shiftCachedBlock(block, delta, lineCount);
    if (!shifted) {
      return undefined;
    }
    repairedBlocks.push(shifted);
  }

  const originalTargetBlock = entry.blocks[blockIndex];
  const repairedTargetBlock = repairedBlocks[blockIndex];
  if (!originalTargetBlock?.blockHash || !repairedTargetBlock) {
    return undefined;
  }

  const targetHash = await safeComputeBlockHash(uri, repairedTargetBlock.startLine, repairedTargetBlock.endLine);
  if (targetHash !== originalTargetBlock.blockHash) {
    return undefined;
  }

  return {
    kind: 'definition-shift',
    delta,
    repairedEntry: {
      ...entry,
      updatedAt: new Date().toISOString(),
      blocks: repairedBlocks,
    },
  };
}

async function buildBlockHashRepairSuggestion(
  document: vscode.TextDocument,
  symbolName: string,
  blockIndex: number,
  entry: CachedSymbolEntry,
): Promise<RepairSuggestion | undefined> {
  if (symbolName === '📄') {
    return undefined;
  }

  const originalTargetBlock = entry.blocks[blockIndex];
  if (!originalTargetBlock?.blockHash) {
    return undefined;
  }

  const blockLength = originalTargetBlock.endLine - originalTargetBlock.startLine + 1;
  if (blockLength <= 0) {
    return undefined;
  }

  const symbol = await findSymbolWithRetry(document.uri, symbolName);
  if (!symbol) {
    return undefined;
  }

  const matchedRange = findUniqueHashMatchedRange(document, symbol.range, originalTargetBlock.blockHash, blockLength);
  if (!matchedRange) {
    return undefined;
  }

  const delta = matchedRange.startLine - originalTargetBlock.startLine;
  if (delta === 0) {
    return undefined;
  }

  const repairedTargetBlock = shiftCachedBlock(originalTargetBlock, delta, document.lineCount);
  if (!repairedTargetBlock || repairedTargetBlock.endLine !== matchedRange.endLine) {
    return undefined;
  }

  return {
    kind: 'block-hash-match',
    repairedEntry: {
      ...entry,
      updatedAt: new Date().toISOString(),
      blocks: entry.blocks.map((block, index) => (
        index === blockIndex ? repairedTargetBlock : block
      )),
    },
  };
}

function findUniqueHashMatchedRange(
  document: vscode.TextDocument,
  symbolRange: vscode.Range,
  blockHash: string,
  blockLength: number,
): { startLine: number; endLine: number } | undefined {
  const matches = findHashMatchedRanges(document, symbolRange, blockHash, blockLength);
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

function findHashMatchedRanges(
  document: vscode.TextDocument,
  symbolRange: vscode.Range,
  blockHash: string,
  blockLength: number,
): Array<{ startLine: number; endLine: number }> {
  const searchStartLine = symbolRange.start.line + 1;
  const searchEndLine = symbolRange.end.line + 1;
  const lastStartLine = searchEndLine - blockLength + 1;
  if (lastStartLine < searchStartLine) {
    return [];
  }

  const matchedRanges: Array<{ startLine: number; endLine: number }> = [];
  for (let startLine = searchStartLine; startLine <= lastStartLine; startLine++) {
    const endLine = startLine + blockLength - 1;
    const currentHash = computeDocumentBlockHash(document, startLine, endLine);
    if (currentHash !== blockHash) {
      continue;
    }
    matchedRanges.push({ startLine, endLine });
  }
  return matchedRanges;
}

function computeDocumentBlockHash(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
): string {
  const lines: string[] = [];
  for (let lineNumber = startLine - 1; lineNumber <= endLine - 1; lineNumber++) {
    lines.push(document.lineAt(lineNumber).text);
  }
  const hash = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  return `sha256:${hash}`;
}

function shiftCachedBlock(block: CachedBlock, delta: number, lineCount: number): CachedBlock | undefined {
  const startLine = block.startLine + delta;
  const endLine = block.endLine + delta;
  if (startLine < 1 || endLine < startLine || endLine > lineCount) {
    return undefined;
  }

  const annotations = block.annotations?.map(annotation => ({
    ...annotation,
    line: annotation.line + delta,
  }));
  if (annotations?.some(annotation => annotation.line < 1 || annotation.line > lineCount)) {
    return undefined;
  }

  return {
    ...block,
    startLine,
    endLine,
    annotations,
  };
}

async function safeComputeBlockHash(
  uri: vscode.Uri,
  startLine: number,
  endLine: number,
): Promise<string | undefined> {
  try {
    return await computeBlockHash(uri, startLine, endLine);
  } catch {
    return undefined;
  }
}

function formatSignedLineDelta(delta: number): string {
  return `${delta > 0 ? '+' : ''}${String(delta)}`;
}

async function findSymbolWithRetry(
  uri: vscode.Uri,
  symbolName: string,
  maxAttempts = 15,
): Promise<vscode.DocumentSymbol | undefined> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const symbol = await findSymbol(uri, symbolName);
    if (symbol) {
      return symbol;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return undefined;
}

async function buildRepairPreviewContext(
  target: WalkthroughBlockNode,
  document: vscode.TextDocument,
  cacheService: CacheService,
): Promise<RepairPreviewContext | undefined> {
  const resolved = await resolveSymbolCache(cacheService, target.filePath, target.symbolName);
  if (!resolved) {
    return undefined;
  }

  const candidates: RepairPreviewCandidateEntry[] = [];
  const definitionCandidate = await buildDefinitionShiftPreviewCandidate(
    document.uri,
    target.symbolName,
    target.sourceBlockIndex,
    resolved.entry,
    document.lineCount,
  );
  if (definitionCandidate) {
    candidates.push(definitionCandidate);
  }

  candidates.push(...await buildBlockHashPreviewCandidates(
    document,
    target.symbolName,
    target.sourceBlockIndex,
    resolved.entry,
  ));

  const deduped = new Map<string, RepairPreviewCandidateEntry>();
  for (const candidate of candidates) {
    const key = `${candidate.candidate.strategy}:${candidate.candidate.startLine}:${candidate.candidate.endLine}`;
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  if (deduped.size === 0) {
    return undefined;
  }

  const symbol = await findSymbolWithRetry(document.uri, target.symbolName);
  const currentCode = symbol
    ? document.getText(symbol.range)
    : document.getText();
  const codeStartLine = symbol ? symbol.range.start.line + 1 : 1;

  const candidateMap = new Map<string, RepairPreviewCandidateEntry>();
  for (const candidate of deduped.values()) {
    candidateMap.set(candidate.candidate.id, candidate);
  }

  return {
    data: {
      filePath: target.filePath,
      symbolName: target.symbolName,
      blockLabel: target.label,
      blockIndex: target.blockIndex,
      source: target.source,
      oldStartLine: target.startLine,
      oldEndLine: target.endLine,
      codeStartLine,
      currentCode,
      candidates: [...candidateMap.values()].map(candidate => candidate.candidate),
      selectedCandidateId: [...candidateMap.keys()][0],
    },
    candidates: candidateMap,
    subDir: resolved.subDir,
  };
}

async function buildDefinitionShiftPreviewCandidate(
  uri: vscode.Uri,
  symbolName: string,
  blockIndex: number,
  entry: CachedSymbolEntry,
  lineCount: number,
): Promise<RepairPreviewCandidateEntry | undefined> {
  if (symbolName === '📄' || entry.blocks.length === 0) {
    return undefined;
  }

  const symbol = await findSymbolWithRetry(uri, symbolName);
  if (!symbol) {
    return undefined;
  }

  const anchorStartLine = Math.min(...entry.blocks.map(block => block.startLine));
  const delta = symbol.range.start.line + 1 - anchorStartLine;
  if (delta === 0) {
    return undefined;
  }

  const repairedBlocks: CachedBlock[] = [];
  for (const block of entry.blocks) {
    const shifted = shiftCachedBlock(block, delta, lineCount);
    if (!shifted) {
      return undefined;
    }
    repairedBlocks.push(shifted);
  }

  const originalTargetBlock = entry.blocks[blockIndex];
  const repairedTargetBlock = repairedBlocks[blockIndex];
  if (!repairedTargetBlock) {
    return undefined;
  }

  const targetHash = originalTargetBlock?.blockHash
    ? await safeComputeBlockHash(uri, repairedTargetBlock.startLine, repairedTargetBlock.endLine)
    : undefined;
  if (originalTargetBlock?.blockHash && targetHash === originalTargetBlock.blockHash) {
    return undefined;
  }

  return {
    candidate: {
      id: `definition-shift:${repairedTargetBlock.startLine}:${repairedTargetBlock.endLine}`,
      strategy: 'definition-shift',
      startLine: repairedTargetBlock.startLine,
      endLine: repairedTargetBlock.endLine,
      summary: l10n.t('Shift all blocks by {0}', formatSignedLineDelta(delta)),
      reason: l10n.t('Definition moved by {0}, but the current block content still needs review.', formatSignedLineDelta(delta)),
      keepsExplanation: true,
      keepsAnnotations: true,
      canApply: false,
    },
  };
}

async function buildBlockHashPreviewCandidates(
  document: vscode.TextDocument,
  symbolName: string,
  blockIndex: number,
  entry: CachedSymbolEntry,
): Promise<RepairPreviewCandidateEntry[]> {
  if (symbolName === '📄') {
    return [];
  }

  const originalTargetBlock = entry.blocks[blockIndex];
  if (!originalTargetBlock?.blockHash) {
    return [];
  }

  const blockLength = originalTargetBlock.endLine - originalTargetBlock.startLine + 1;
  if (blockLength <= 0) {
    return [];
  }

  const symbol = await findSymbolWithRetry(document.uri, symbolName);
  if (!symbol) {
    return [];
  }

  const matchedRanges = findHashMatchedRanges(document, symbol.range, originalTargetBlock.blockHash, blockLength);
  if (matchedRanges.length <= 1) {
    return [];
  }

  const candidates: RepairPreviewCandidateEntry[] = [];
  for (const matchedRange of matchedRanges) {
    const repairedEntry = buildRepairedEntryForTargetBlock(entry, blockIndex, matchedRange.startLine, matchedRange.endLine, document.lineCount);
    if (!repairedEntry) {
      continue;
    }
    candidates.push({
      candidate: {
        id: `block-hash-match:${matchedRange.startLine}:${matchedRange.endLine}`,
        strategy: 'block-hash-match',
        startLine: matchedRange.startLine,
        endLine: matchedRange.endLine,
        summary: l10n.t('Hash matched at L{0}-L{1}', matchedRange.startLine, matchedRange.endLine),
        reason: l10n.t('The same block hash matched in multiple locations within the current symbol.'),
        keepsExplanation: true,
        keepsAnnotations: true,
        canApply: true,
      },
      repairedEntry,
    });
  }

  return candidates;
}

function buildRepairedEntryForTargetBlock(
  entry: CachedSymbolEntry,
  blockIndex: number,
  startLine: number,
  endLine: number,
  lineCount: number,
): CachedSymbolEntry | undefined {
  const targetBlock = entry.blocks[blockIndex];
  if (!targetBlock) {
    return undefined;
  }

  const delta = startLine - targetBlock.startLine;
  const shiftedBlock = shiftCachedBlock(targetBlock, delta, lineCount);
  if (!shiftedBlock || shiftedBlock.endLine !== endLine) {
    return undefined;
  }

  return {
    ...entry,
    updatedAt: new Date().toISOString(),
    blocks: entry.blocks.map((block, index) => (
      index === blockIndex ? shiftedBlock : block
    )),
  };
}

async function clearFileNodeCache(
  filePath: string,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
): Promise<void> {
  const cacheRelPath = toCacheRelPath(filePath);
  let deleted = 0;

  for (const subDir of ['walks-manual', 'walks-auto'] as const) {
    if (await cacheService.deleteFile(subDir, cacheRelPath)) {
      deleted++;
    }
    if (await cacheService.deleteDir(subDir, cacheRelPath)) {
      deleted++;
    }
  }

  if (deleted === 0) {
    void notifyInfo(l10n.t('CodeWalker: No cache found to delete.'));
    return;
  }

  const uri = resolveFileUri(filePath);
  blockStore.clearUri(uri);
  clearHighlighterUri(uri.toString());
  restoredUris.delete(uri.toString());
  void notifyInfo(l10n.t('CodeWalker: Cache for {0} deleted.', filePath));
}

async function clearSymbolNodeCache(
  filePath: string,
  symbolName: string,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoredUris: Set<string>,
): Promise<void> {
  const cacheRelPath = toCacheRelPath(filePath);
  let deleted = false;

  for (const subDir of ['walks-manual', 'walks-auto'] as const) {
    const data = await cacheService.readFile(subDir, cacheRelPath);
    if (!data?.symbols[symbolName]) {
      continue;
    }

    delete data.symbols[symbolName];
    deleted = true;

    if (Object.keys(data.symbols).length === 0) {
      await cacheService.deleteFile(subDir, cacheRelPath);
      await cacheService.deleteDir(subDir, cacheRelPath);
    } else {
      await cacheService.writeFile(subDir, cacheRelPath, data);
      await deleteMarkdownExport(subDir, cacheRelPath, symbolName);
    }
  }

  if (!deleted) {
    void notifyInfo(l10n.t('CodeWalker: No cache found to delete.'));
    return;
  }

  const uri = resolveFileUri(filePath);
  blockStore.removeSymbol(uri, symbolName);
  clearSymbolByUri(uri, symbolName);
  if (blockStore.getSymbolNames(uri).length === 0) {
    clearHighlighterUri(uri.toString());
    restoredUris.delete(uri.toString());
  }

  void notifyInfo(l10n.t('CodeWalker: Cache for symbol "{0}" deleted.', symbolName));
}

async function deleteMarkdownExport(
  subDir: CacheSubDir,
  cacheRelPath: string,
  symbolName: string,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  try {
    await vscode.workspace.fs.delete(
      vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', subDir, cacheRelPath, `${symbolName}.md`),
    );
  } catch {
    // ignore missing markdown export
  }
}

async function pickRepairTarget(node: SidebarNode): Promise<WalkthroughBlockNode | undefined> {
  const staleBlocks = collectStaleBlocks(node);
  if (staleBlocks.length === 0) {
    return undefined;
  }
  if (staleBlocks.length === 1) {
    return staleBlocks[0];
  }

  const choice = await vscode.window.showQuickPick(
    staleBlocks.map(block => ({
      label: `${block.symbolName} — ${block.label}`,
      description: `${block.source === 'manual' ? l10n.t('Manual') : l10n.t('Auto')} • L${block.startLine}-L${block.endLine}`,
      detail: block.filePath,
      block,
    })),
    {
      title: l10n.t('CodeWalker: Repair stale block'),
      placeHolder: l10n.t('Select a stale block to repair'),
      ignoreFocusOut: true,
    },
  );
  return choice?.block;
}

function collectStaleBlocks(node: SidebarNode): WalkthroughBlockNode[] {
  if (node.kind === 'walkthrough-block') {
    return node.stale ? [node] : [];
  }
  if (node.kind === 'walkthrough-symbol') {
    return node.children.filter(child => child.stale);
  }
  if (node.kind === 'walkthrough-file') {
    return node.children.flatMap(symbol => symbol.children.filter(block => block.stale));
  }
  return [];
}