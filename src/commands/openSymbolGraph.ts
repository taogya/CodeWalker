import * as path from 'path';
import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { CacheService } from '@cache/cacheService';
import type { CachedSymbolEntry } from '@cache/cacheTypes';
import type { SidebarDataService } from '@sidebar/sidebarDataService';
import type { SidebarSnapshot } from '@sidebar/types';
import type { BlockStore } from '@walker/blockStore';
import { showBlockDetailCommand } from '@commands/showBlockDetail';
import { lineRange, openFileInEditor, resolveFileUri, toCacheRelPath } from '@utils/fileUtils';
import { log } from '@utils/logger';

export type GraphNodeKind = 'file' | 'symbol' | 'block';
export type GraphEdgeKind = 'contains' | 'imports' | 'references';
export type GraphNodeStatus = 'manual' | 'auto' | 'mixed' | 'stale' | 'none';

export interface SymbolGraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  status: GraphNodeStatus;
  filePath: string;
  symbolName?: string;
  blockIndex?: number;
  line?: number;
  endLine?: number;
  source?: 'manual' | 'auto';
  overview?: string;
  updatedAt?: string;
  blockCount?: number;
}

export interface SymbolGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface SymbolGraphSnapshot {
  nodes: SymbolGraphNode[];
  edges: SymbolGraphEdge[];
  generatedAt: string;
}

interface SymbolSeed {
  nodeId: string;
  filePath: string;
  symbolName: string;
  line: number;
  endLine: number;
}

let graphPanel: vscode.WebviewPanel | undefined;

export async function buildSymbolGraphSnapshot(
  sidebarDataService: SidebarDataService,
  cacheService: CacheService,
): Promise<SymbolGraphSnapshot> {
  const snapshot = await sidebarDataService.getSnapshot();
  const nodeMap = new Map<string, SymbolGraphNode>();
  const edgeMap = new Map<string, SymbolGraphEdge>();
  const symbolSeeds = new Map<string, SymbolSeed>();

  await addWalkthroughNodes(snapshot, cacheService, nodeMap, edgeMap, symbolSeeds);
  addTargetNodes(snapshot, nodeMap, edgeMap, symbolSeeds);
  await addImportEdges(nodeMap, edgeMap);
  await addReferenceEdges(symbolSeeds, edgeMap);

  return {
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    generatedAt: new Date().toISOString(),
  };
}

export async function openSymbolGraphCommand(
  extensionUri: vscode.Uri,
  sidebarDataService: SidebarDataService,
  cacheService: CacheService,
  blockStore: BlockStore,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
): Promise<void> {
  const snapshot = await buildSymbolGraphSnapshot(sidebarDataService, cacheService);

  if (graphPanel) {
    graphPanel.webview.html = buildGraphHtml(snapshot, graphPanel.webview);
    setupGraphMessageHandler(graphPanel, blockStore, cacheService, restoreFromCache);
    graphPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  graphPanel = vscode.window.createWebviewPanel(
    'codeWalkerSymbolGraph',
    l10n.t('CodeWalker: Symbol Graph'),
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    },
  );

  graphPanel.webview.html = buildGraphHtml(snapshot, graphPanel.webview);
  setupGraphMessageHandler(graphPanel, blockStore, cacheService, restoreFromCache);
  graphPanel.onDidDispose(() => {
    graphPanel = undefined;
  });
}

export function disposeSymbolGraphPanel(): void {
  graphPanel?.dispose();
  graphPanel = undefined;
}

async function addWalkthroughNodes(
  snapshot: SidebarSnapshot,
  cacheService: CacheService,
  nodeMap: Map<string, SymbolGraphNode>,
  edgeMap: Map<string, SymbolGraphEdge>,
  symbolSeeds: Map<string, SymbolSeed>,
): Promise<void> {
  for (const fileNode of snapshot.walkthroughFiles) {
    const fileId = fileNodeId(fileNode.filePath);
    const childStatuses: GraphNodeStatus[] = [];
    let blockCount = 0;

    for (const symbolNode of fileNode.children) {
      const symbolId = symbolNodeId(fileNode.filePath, symbolNode.symbolName);
      const resolved = await resolveSymbolEntry(cacheService, fileNode.filePath, symbolNode.symbolName);
      const symbolStatus = symbolNode.staleBlockCount > 0
        ? 'stale'
        : symbolNode.hasManual && symbolNode.hasAuto
          ? 'mixed'
          : symbolNode.source;

      const line = symbolNode.children.length > 0
        ? Math.min(...symbolNode.children.map(block => block.startLine))
        : 1;
      const endLine = symbolNode.children.length > 0
        ? Math.max(...symbolNode.children.map(block => block.endLine))
        : line;

      nodeMap.set(symbolId, {
        id: symbolId,
        kind: 'symbol',
        label: symbolNode.symbolName,
        status: symbolStatus,
        filePath: fileNode.filePath,
        symbolName: symbolNode.symbolName,
        line,
        endLine,
        source: symbolNode.source,
        overview: resolved?.overview,
        updatedAt: resolved?.updatedAt,
        blockCount: symbolNode.children.length,
      });
      edgeMap.set(edgeId(fileId, symbolId, 'contains'), {
        id: edgeId(fileId, symbolId, 'contains'),
        from: fileId,
        to: symbolId,
        kind: 'contains',
      });
      symbolSeeds.set(symbolId, {
        nodeId: symbolId,
        filePath: fileNode.filePath,
        symbolName: symbolNode.symbolName,
        line,
        endLine,
      });

      childStatuses.push(symbolStatus);
      blockCount += symbolNode.children.length;

      for (const blockNode of symbolNode.children) {
        const blockId = blockNodeId(fileNode.filePath, symbolNode.symbolName, blockNode.blockIndex);
        nodeMap.set(blockId, {
          id: blockId,
          kind: 'block',
          label: blockNode.label,
          status: blockNode.stale ? 'stale' : blockNode.source,
          filePath: fileNode.filePath,
          symbolName: symbolNode.symbolName,
          blockIndex: blockNode.blockIndex,
          line: blockNode.startLine,
          endLine: blockNode.endLine,
          source: blockNode.source,
        });
        edgeMap.set(edgeId(symbolId, blockId, 'contains'), {
          id: edgeId(symbolId, blockId, 'contains'),
          from: symbolId,
          to: blockId,
          kind: 'contains',
        });
      }
    }

    nodeMap.set(fileId, {
      id: fileId,
      kind: 'file',
      label: path.basename(fileNode.filePath),
      status: deriveFileStatus(childStatuses),
      filePath: fileNode.filePath,
      blockCount,
    });
  }
}

function addTargetNodes(
  snapshot: SidebarSnapshot,
  nodeMap: Map<string, SymbolGraphNode>,
  edgeMap: Map<string, SymbolGraphEdge>,
  symbolSeeds: Map<string, SymbolSeed>,
): void {
  for (const group of snapshot.targetGroups) {
    for (const target of group.children) {
      const fileId = fileNodeId(target.filePath);
      if (!nodeMap.has(fileId)) {
        nodeMap.set(fileId, {
          id: fileId,
          kind: 'file',
          label: path.basename(target.filePath),
          status: 'none',
          filePath: target.filePath,
          blockCount: 0,
        });
      }

      const symbolId = symbolNodeId(target.filePath, target.symbolName);
      if (!nodeMap.has(symbolId)) {
        nodeMap.set(symbolId, {
          id: symbolId,
          kind: 'symbol',
          label: target.symbolName,
          status: 'none',
          filePath: target.filePath,
          symbolName: target.symbolName,
          line: target.line,
          endLine: target.endLine ?? target.line,
          blockCount: 0,
        });
        edgeMap.set(edgeId(fileId, symbolId, 'contains'), {
          id: edgeId(fileId, symbolId, 'contains'),
          from: fileId,
          to: symbolId,
          kind: 'contains',
        });
        symbolSeeds.set(symbolId, {
          nodeId: symbolId,
          filePath: target.filePath,
          symbolName: target.symbolName,
          line: target.line,
          endLine: target.endLine ?? target.line,
        });
      }
    }
  }
}

async function addImportEdges(
  nodeMap: Map<string, SymbolGraphNode>,
  edgeMap: Map<string, SymbolGraphEdge>,
): Promise<void> {
  const fileNodes = [...nodeMap.values()].filter(node => node.kind === 'file');
  const knownFiles = new Set(fileNodes.map(node => node.filePath));

  for (const fileNode of fileNodes) {
    const importedFiles = await resolveImportedWorkspaceFiles(fileNode.filePath, knownFiles);
    for (const importedFile of importedFiles) {
      const importedFileId = fileNodeId(importedFile);
      if (!nodeMap.has(importedFileId)) {
        nodeMap.set(importedFileId, {
          id: importedFileId,
          kind: 'file',
          label: path.basename(importedFile),
          status: 'none',
          filePath: importedFile,
          blockCount: 0,
        });
      }
      edgeMap.set(edgeId(fileNode.id, importedFileId, 'imports'), {
        id: edgeId(fileNode.id, importedFileId, 'imports'),
        from: fileNode.id,
        to: importedFileId,
        kind: 'imports',
      });
    }
  }
}

async function addReferenceEdges(
  symbolSeeds: Map<string, SymbolSeed>,
  edgeMap: Map<string, SymbolGraphEdge>,
): Promise<void> {
  const symbols = [...symbolSeeds.values()];
  for (const symbol of symbols) {
    const body = await readFileRange(symbol.filePath, symbol.line, symbol.endLine);
    if (!body) {
      continue;
    }
    for (const candidate of symbols) {
      if (candidate.nodeId === symbol.nodeId || candidate.symbolName.length < 3) {
        continue;
      }
      const matcher = new RegExp(`\\b${escapeRegExp(candidate.symbolName)}\\b`);
      if (!matcher.test(body)) {
        continue;
      }
      edgeMap.set(edgeId(symbol.nodeId, candidate.nodeId, 'references'), {
        id: edgeId(symbol.nodeId, candidate.nodeId, 'references'),
        from: symbol.nodeId,
        to: candidate.nodeId,
        kind: 'references',
      });
    }
  }
}

async function resolveSymbolEntry(
  cacheService: CacheService,
  filePath: string,
  symbolName: string,
): Promise<CachedSymbolEntry | undefined> {
  const cacheRelPath = toCacheRelPath(filePath);
  for (const subDir of ['walks-manual', 'walks-auto'] as const) {
    const data = await cacheService.readFile(subDir, cacheRelPath);
    const entry = data?.symbols[symbolName];
    if (entry) {
      return entry;
    }
  }
  return undefined;
}

async function resolveImportedWorkspaceFiles(filePath: string, knownFiles: Set<string>): Promise<string[]> {
  const text = await readWorkspaceText(filePath);
  if (!text) {
    return [];
  }

  const imported = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const importTarget = extractImportTarget(line);
    if (!importTarget) {
      continue;
    }
    const resolved = await resolveImportSpecifier(filePath, importTarget, knownFiles);
    if (resolved) {
      imported.add(resolved);
      knownFiles.add(resolved);
    }
  }

  return [...imported];
}

function extractImportTarget(line: string): string | undefined {
  const pythonFrom = line.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+/);
  if (pythonFrom) {
    return pythonFrom[1];
  }

  const pythonImport = line.match(/^import\s+([A-Za-z0-9_\.]+)/);
  if (pythonImport) {
    return pythonImport[1];
  }

  const jsImport = line.match(/^import(?:.+from\s+)?["']([^"']+)["']/);
  if (jsImport) {
    return jsImport[1];
  }

  return undefined;
}

async function resolveImportSpecifier(
  filePath: string,
  specifier: string,
  knownFiles: Set<string>,
): Promise<string | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  if (specifier.startsWith('.')) {
    const baseDir = path.posix.dirname(filePath);
    for (const candidate of expandImportCandidates(path.posix.normalize(path.posix.join(baseDir, specifier)))) {
      if (await workspaceFileExists(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  const moduleName = specifier.split('.').pop() ?? specifier;
  const currentDir = path.posix.dirname(filePath);
  for (const candidate of expandImportCandidates(path.posix.join(currentDir, moduleName))) {
    if (await workspaceFileExists(candidate)) {
      return candidate;
    }
  }

  for (const knownFile of knownFiles) {
    if (path.basename(knownFile, path.extname(knownFile)) === moduleName) {
      return knownFile;
    }
  }

  for (const candidate of expandImportCandidates(moduleName)) {
    if (await workspaceFileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function expandImportCandidates(basePath: string): string[] {
  if (path.extname(basePath)) {
    return [basePath];
  }
  return [
    `${basePath}.py`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.posix.join(basePath, 'index.ts'),
    path.posix.join(basePath, 'index.js'),
  ];
}

async function workspaceFileExists(relativePath: string): Promise<boolean> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return false;
  }

  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceFolder.uri, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readFileRange(filePath: string, startLine: number, endLine: number): Promise<string> {
  const text = await readWorkspaceText(filePath);
  if (!text) {
    return '';
  }

  const documentLines = text.split(/\r?\n/);
  const lines: string[] = [];
  const start = Math.max(0, startLine - 1);
  const end = Math.min(documentLines.length - 1, endLine - 1);
  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    lines.push(documentLines[lineNumber]);
  }
  return lines.join('\n');
}

async function readWorkspaceText(filePath: string): Promise<string> {
  try {
    const raw = await vscode.workspace.fs.readFile(resolveFileUri(filePath));
    return Buffer.from(raw).toString('utf-8');
  } catch {
    return '';
  }
}

function deriveFileStatus(statuses: GraphNodeStatus[]): GraphNodeStatus {
  if (statuses.includes('stale')) {
    return 'stale';
  }
  const effective = statuses.filter(status => status !== 'none');
  if (effective.length === 0) {
    return 'none';
  }
  if (effective.every(status => status === 'manual')) {
    return 'manual';
  }
  if (effective.every(status => status === 'auto')) {
    return 'auto';
  }
  return 'mixed';
}

function fileNodeId(filePath: string): string {
  return `file::${filePath}`;
}

function symbolNodeId(filePath: string, symbolName: string): string {
  return `symbol::${filePath}::${symbolName}`;
}

function blockNodeId(filePath: string, symbolName: string, blockIndex: number): string {
  return `block::${filePath}::${symbolName}::${blockIndex}`;
}

function edgeId(from: string, to: string, kind: GraphEdgeKind): string {
  return `${kind}::${from}::${to}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setupGraphMessageHandler(
  panel: vscode.WebviewPanel,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
): void {
  panel.webview.onDidReceiveMessage(async (message) => {
    const node = message?.node as SymbolGraphNode | undefined;
    if (!node) {
      return;
    }

    if (message.type === 'openNode') {
      await openGraphNode(node);
      return;
    }

    if (message.type === 'showDetail') {
      await showGraphNodeDetail(node, blockStore, cacheService, restoreFromCache);
    }
  });
}

async function openGraphNode(node: SymbolGraphNode): Promise<void> {
  const uri = resolveFileUri(node.filePath);
  const editor = await openFileInEditor(uri);
  if (node.line && node.endLine) {
    editor.revealRange(lineRange(editor.document, node.line, node.endLine), vscode.TextEditorRevealType.InCenter);
  }
}

async function showGraphNodeDetail(
  node: SymbolGraphNode,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
): Promise<void> {
  const uri = resolveFileUri(node.filePath);
  const editor = await openFileInEditor(uri);
  await restoreFromCache(editor, blockStore, cacheService);

  if (node.kind === 'block' && node.symbolName !== undefined && node.blockIndex !== undefined) {
    await showBlockDetailCommand(blockStore, uri, node.symbolName, node.blockIndex);
    return;
  }

  if (node.kind === 'symbol' && node.symbolName) {
    const details = blockStore.getBlockDetails(uri, node.symbolName);
    if (details && details.length > 0) {
      await showBlockDetailCommand(blockStore, uri, node.symbolName, 0);
      return;
    }
  }

  if (node.line && node.endLine) {
    editor.revealRange(lineRange(editor.document, node.line, node.endLine), vscode.TextEditorRevealType.InCenter);
  }
}

function buildGraphHtml(snapshot: SymbolGraphSnapshot, webview: vscode.Webview): string {
  const data = JSON.stringify(snapshot);
  const nonce = getNonce();
  const strings = JSON.stringify({
    searchPlaceholder: l10n.t('Search symbol or file'),
    folderPlaceholder: l10n.t('Folder prefix filter (e.g. src/ or graph-fixtures/)'),
    staleOnly: l10n.t('Stale only'),
    manualOnly: l10n.t('Manual only'),
    manual: l10n.t('Manual'),
    auto: l10n.t('Auto'),
    mixed: l10n.t('Mixed'),
    stale: l10n.t('Stale'),
    noWalkthrough: l10n.t('No walkthrough'),
    noNodes: l10n.t('No graph nodes matched the current filters.'),
    selectNode: l10n.t('Select a node to inspect its walkthrough metadata.'),
    kind: l10n.t('Kind'),
    status: l10n.t('Status'),
    symbol: l10n.t('Symbol'),
    file: l10n.t('File'),
    range: l10n.t('Range'),
    blocks: l10n.t('Blocks'),
    updated: l10n.t('Updated'),
    overview: l10n.t('Overview'),
    noOverview: l10n.t('No overview cached.'),
    open: l10n.t('Open'),
    showDetail: l10n.t('Show Detail'),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeWalker Symbol Graph</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--vscode-editor-background);
    --panel: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-editorWidget-border) 14%);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-editorWidget-border);
    --text: var(--vscode-editor-foreground);
    --manual: #0b7a75;
    --auto: #2f5fb3;
    --mixed: #9c5c00;
    --stale: #b42318;
    --none: #6b7280;
  }
  body {
    margin: 0;
    background: radial-gradient(circle at top left, color-mix(in srgb, var(--bg) 85%, #1f6f78 15%), var(--bg));
    color: var(--text);
    font-family: Georgia, 'Iowan Old Style', serif;
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    min-height: 100vh;
  }
  .main {
    padding: 18px;
  }
  .toolbar {
    display: grid;
    grid-template-columns: 1.2fr 1fr auto auto;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
  }
  input, button {
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    border-radius: 10px;
    padding: 10px 12px;
  }
  button {
    cursor: pointer;
  }
  .graph {
    position: relative;
    min-height: calc(100vh - 120px);
    background: color-mix(in srgb, var(--bg) 88%, black 12%);
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: auto;
  }
  .graph svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .node-layer {
    position: relative;
    min-height: 1200px;
  }
  .node {
    position: absolute;
    width: 220px;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, currentColor 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--panel) 82%, currentColor 18%);
    color: var(--text);
    text-align: left;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
  }
  .node.selected {
    outline: 2px solid color-mix(in srgb, currentColor 80%, white 20%);
    transform: translateY(-2px);
  }
  .node[data-kind="file"] { color: var(--mixed); }
  .node[data-status="manual"] { color: var(--manual); }
  .node[data-status="auto"] { color: var(--auto); }
  .node[data-status="mixed"] { color: var(--mixed); }
  .node[data-status="stale"] { color: var(--stale); }
  .node[data-status="none"] { color: var(--none); }
  .node small {
    display: block;
    color: var(--muted);
    margin-top: 6px;
  }
  .side {
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 76%, black 24%);
    padding: 18px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: currentColor;
  }
  .detail-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .empty {
    color: var(--muted);
    padding: 24px;
  }
  .edge-imports { stroke: color-mix(in srgb, var(--auto) 70%, white 30%); stroke-dasharray: 6 4; }
  .edge-references { stroke: color-mix(in srgb, var(--mixed) 75%, white 25%); }
  .edge-contains { stroke: color-mix(in srgb, var(--border) 30%, white 70%); }
</style>
</head>
<body>
<div class="shell">
  <div class="main">
    <div class="toolbar">
      <input id="search" placeholder="${l10n.t('Search symbol or file')}">
      <input id="folder" placeholder="${l10n.t('Folder prefix filter (e.g. src/ or graph-fixtures/)')}">
      <button id="staleOnly">${l10n.t('Stale only')}</button>
      <button id="manualOnly">${l10n.t('Manual only')}</button>
    </div>
    <div class="graph" id="graph">
      <svg id="edges"></svg>
      <div class="node-layer" id="nodes"></div>
    </div>
  </div>
  <aside class="side">
    <div class="legend">
      <span class="chip" style="color: var(--manual)"><span class="dot"></span>${l10n.t('Manual')}</span>
      <span class="chip" style="color: var(--auto)"><span class="dot"></span>${l10n.t('Auto')}</span>
      <span class="chip" style="color: var(--mixed)"><span class="dot"></span>${l10n.t('Mixed')}</span>
      <span class="chip" style="color: var(--stale)"><span class="dot"></span>${l10n.t('Stale')}</span>
      <span class="chip" style="color: var(--none)"><span class="dot"></span>${l10n.t('No walkthrough')}</span>
    </div>
    <div id="detail"></div>
  </aside>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const data = ${data};
const i18n = ${strings};
const state = {
  selectedId: data.nodes[0]?.id,
  staleOnly: false,
  manualOnly: false,
  search: '',
  folder: '',
};
const nodeMap = new Map(data.nodes.map(node => [node.id, node]));
const containsEdges = data.edges.filter(edge => edge.kind === 'contains');
    nodeLayer.innerHTML = '<div class="empty">' + i18n.noNodes + '</div>';
const parentMap = new Map();
for (const edge of containsEdges) {
  if (!childMap.has(edge.from)) childMap.set(edge.from, []);
  childMap.get(edge.from).push(edge.to);
  parentMap.set(edge.to, edge.from);
}

function matchesNode(node) {
  const search = state.search.toLowerCase();
  if (search) {
    const haystack = [node.label, node.filePath, node.symbolName].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (state.folder && !node.filePath.startsWith(state.folder)) return false;
  if (state.staleOnly && node.status !== 'stale') return false;
  if (state.manualOnly) {
    const isManual = node.status === 'manual' || node.status === 'mixed' || node.source === 'manual';
    if (!isManual) return false;
  }
  return true;
}

function collectVisibleIds() {
  const direct = new Set(data.nodes.filter(matchesNode).map(node => node.id));
  if (!state.search && !state.folder && !state.staleOnly && !state.manualOnly) {
    return new Set(data.nodes.map(node => node.id));
  }
  const visible = new Set(direct);
  const queue = [...direct];
  while (queue.length > 0) {
    const current = queue.pop();
    const parent = parentMap.get(current);
    if (parent && !visible.has(parent)) {
      visible.add(parent);
      queue.push(parent);
    }
    const children = childMap.get(current) || [];
    for (const child of children) {
      if (!visible.has(child)) {
        visible.add(child);
        queue.push(child);
      }
    }
  }
  return visible;
}

function layout(visibleIds) {
  const visibleNodes = data.nodes.filter(node => visibleIds.has(node.id));
  const files = visibleNodes.filter(node => node.kind === 'file').sort((a, b) => a.filePath.localeCompare(b.filePath));
  const positions = new Map();
  let y = 40;
  for (const file of files) {
    positions.set(file.id, { x: 60, y });
    y += 96;
    const symbols = (childMap.get(file.id) || []).map(id => nodeMap.get(id)).filter(Boolean);
    for (const symbol of symbols) {
      positions.set(symbol.id, { x: 360, y });
      y += 96;
      const blocks = (childMap.get(symbol.id) || []).map(id => nodeMap.get(id)).filter(Boolean);
      for (const block of blocks) {
        positions.set(block.id, { x: 660, y });
        y += 86;
      }
    }
    y += 24;
  }
  return { positions, height: Math.max(y + 100, 900) };
}

function render() {
  const visibleIds = collectVisibleIds();
  const { positions, height } = layout(visibleIds);
  const nodeLayer = document.getElementById('nodes');
  const edgesSvg = document.getElementById('edges');
  nodeLayer.innerHTML = '';
  nodeLayer.style.minHeight = height + 'px';
  edgesSvg.setAttribute('viewBox', '0 0 980 ' + height);
  edgesSvg.innerHTML = '';

  for (const edge of data.edges) {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(from.x + 220));
    line.setAttribute('y1', String(from.y + 28));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y + 28));
    line.setAttribute('stroke-width', edge.kind === 'contains' ? '1.5' : '2');
    line.setAttribute('class', 'edge-' + edge.kind);
    edgesSvg.appendChild(line);
  }

  const orderedNodes = data.nodes.filter(node => visibleIds.has(node.id)).sort((a, b) => {
    const pa = positions.get(a.id); const pb = positions.get(b.id);
    return pa.y - pb.y || pa.x - pb.x;
  });

  if (orderedNodes.length === 0) {
    nodeLayer.innerHTML = '<div class="empty">No graph nodes matched the current filters.</div>';
  }

  for (const node of orderedNodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const button = document.createElement('button');
    button.className = 'node' + (node.id === state.selectedId ? ' selected' : '');
    button.dataset.kind = node.kind;
    button.dataset.status = node.status;
    button.style.left = pos.x + 'px';
    button.style.top = pos.y + 'px';
    button.innerHTML = '<strong>' + escapeHtml(node.label) + '</strong>' +
      '<small>' + escapeHtml(node.kind.toUpperCase() + ' • ' + node.status) + '</small>' +
      '<small>' + escapeHtml(node.filePath) + '</small>';
    button.addEventListener('click', () => {
      state.selectedId = node.id;
      render();
    });
    nodeLayer.appendChild(button);
  }

  renderDetail();
}

function renderDetail() {
  const detail = document.getElementById('detail');
  const node = nodeMap.get(state.selectedId);
  if (!node) {
    detail.innerHTML = '<p class="empty">' + i18n.selectNode + '</p>';
    return;
  }

  detail.innerHTML = [
    '<h2>' + escapeHtml(node.label) + '</h2>',
    '<p><strong>' + i18n.kind + ':</strong> ' + escapeHtml(node.kind) + '</p>',
    '<p><strong>' + i18n.status + ':</strong> ' + escapeHtml(node.status) + '</p>',
    node.symbolName ? '<p><strong>' + i18n.symbol + ':</strong> ' + escapeHtml(node.symbolName) + '</p>' : '',
    '<p><strong>' + i18n.file + ':</strong> ' + escapeHtml(node.filePath) + '</p>',
    node.line ? '<p><strong>' + i18n.range + ':</strong> L' + node.line + '-L' + (node.endLine || node.line) + '</p>' : '',
    typeof node.blockCount === 'number' ? '<p><strong>' + i18n.blocks + ':</strong> ' + node.blockCount + '</p>' : '',
    node.updatedAt ? '<p><strong>' + i18n.updated + ':</strong> ' + escapeHtml(node.updatedAt) + '</p>' : '',
    node.overview ? '<p><strong>' + i18n.overview + ':</strong> ' + escapeHtml(node.overview) + '</p>' : '<p class="empty">' + i18n.noOverview + '</p>',
    '<div class="detail-actions">',
    '<button id="openButton">' + i18n.open + '</button>',
    (node.kind !== 'file' ? '<button id="detailButton">' + i18n.showDetail + '</button>' : ''),
    '</div>',
  ].join('');

  document.getElementById('openButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openNode', node });
  });
  document.getElementById('detailButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'showDetail', node });
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('search').addEventListener('input', (event) => {
  state.search = event.target.value;
  render();
});
document.getElementById('folder').addEventListener('input', (event) => {
  state.folder = event.target.value.trim();
  render();
});
document.getElementById('staleOnly').addEventListener('click', () => {
  state.staleOnly = !state.staleOnly;
  render();
});
document.getElementById('manualOnly').addEventListener('click', () => {
  state.manualOnly = !state.manualOnly;
  render();
});
render();
</script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
