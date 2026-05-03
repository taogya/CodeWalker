import * as path from 'path';
import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { readAllCacheFilesFromRoot } from '@cache/cacheSnapshot';
import type { CachedBlock, CachedFileExport, CachedSymbolEntry } from '@cache/cacheTypes';
import type { CacheService } from '@cache/cacheService';
import type { BlockStore } from '@walker/blockStore';
import { showBlockDetailCommand } from '@commands/showBlockDetail';
import { openComparePanelFromRoots } from '@commands/compareWalkthroughs';
import { lineRange, openFileInEditor, resolveFileUri } from '@utils/fileUtils';

export interface TimelineSnapshotMeta {
  id: string;
  label: string;
  rootPath: string;
  capturedAt?: string;
  symbolCount: number;
  manualCount: number;
  autoCount: number;
  staleCount: number;
}

export interface TimelinePoint {
  snapshotId: string;
  source: 'manual' | 'auto' | 'none';
  blockCount: number;
  stale: boolean;
  updatedAt?: string;
  changeMagnitude: number;
}

export interface TimelineSymbolRow {
  key: string;
  filePath: string;
  symbolName: string;
  points: TimelinePoint[];
}

export interface TimelineData {
  snapshots: TimelineSnapshotMeta[];
  symbols: TimelineSymbolRow[];
  generatedAt: string;
}

interface TimelineCommandOptions {
  snapshotRoots?: vscode.Uri[];
}

let timelinePanel: vscode.WebviewPanel | undefined;

export async function buildTimelineData(extraRoots: vscode.Uri[] = []): Promise<TimelineData> {
  const roots = await collectTimelineRoots(extraRoots);
  const snapshots: TimelineSnapshotMeta[] = [];
  const entriesBySnapshot = new Map<string, Map<string, CachedSymbolEntry>>();
  const allSymbolKeys = new Set<string>();

  for (const { id, label, rootUri } of roots) {
    const files = await readAllCacheFilesFromRoot(rootUri);
    const merged = flattenSymbols(files);
    entriesBySnapshot.set(id, merged);
    for (const key of merged.keys()) {
      allSymbolKeys.add(key);
    }

    const values = [...merged.values()];
    snapshots.push({
      id,
      label,
      rootPath: rootUri.fsPath,
      capturedAt: latestUpdatedAt(values),
      symbolCount: values.length,
      manualCount: values.filter(entry => entry.source === 'manual').length,
      autoCount: values.filter(entry => entry.source === 'auto').length,
      staleCount: await countStaleEntries(merged),
    });
  }

  const symbols: TimelineSymbolRow[] = [];
  for (const key of [...allSymbolKeys].sort()) {
    const [filePath, symbolName] = key.split('::');
    const points: TimelinePoint[] = [];
    let previous: TimelinePoint | undefined;

    for (const snapshot of snapshots) {
      const entry = entriesBySnapshot.get(snapshot.id)?.get(key);
      const point: TimelinePoint = entry
        ? {
            snapshotId: snapshot.id,
            source: entry.source,
            blockCount: entry.blocks.length,
            stale: await hasStaleBlocks(filePath, entry.blocks),
            updatedAt: entry.updatedAt,
            changeMagnitude: 0,
          }
        : {
            snapshotId: snapshot.id,
            source: 'none',
            blockCount: 0,
            stale: false,
            changeMagnitude: 0,
          };

      point.changeMagnitude = computeChangeMagnitude(previous, point);
      previous = point;
      points.push(point);
    }

    symbols.push({ key, filePath, symbolName, points });
  }

  return {
    snapshots,
    symbols,
    generatedAt: new Date().toISOString(),
  };
}

export async function openTimelineCommand(
  extensionUri: vscode.Uri,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  options?: TimelineCommandOptions | vscode.Uri[],
): Promise<void> {
  const extraRoots = Array.isArray(options)
    ? options
    : options?.snapshotRoots ?? await promptForTimelineRoots();
  const data = await buildTimelineData(extraRoots);

  if (timelinePanel) {
    timelinePanel.webview.html = buildTimelineHtml(data, timelinePanel.webview);
    setupTimelineMessageHandler(timelinePanel, extensionUri, blockStore, cacheService, restoreFromCache, data);
    timelinePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  timelinePanel = vscode.window.createWebviewPanel(
    'codeWalkerTimeline',
    l10n.t('CodeWalker: Timeline'),
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    },
  );

  timelinePanel.webview.html = buildTimelineHtml(data, timelinePanel.webview);
  setupTimelineMessageHandler(timelinePanel, extensionUri, blockStore, cacheService, restoreFromCache, data);
  timelinePanel.onDidDispose(() => {
    timelinePanel = undefined;
  });
}

export function disposeTimelinePanel(): void {
  timelinePanel?.dispose();
  timelinePanel = undefined;
}

async function promptForTimelineRoots(): Promise<vscode.Uri[]> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: l10n.t('$(history) Current .code-walker only'), value: 'current' },
      { label: l10n.t('$(folder-opened) Current + select snapshot folders'), value: 'pick' },
    ],
    {
      title: l10n.t('CodeWalker: Timeline'),
      placeHolder: l10n.t('Choose snapshot sources'),
      ignoreFocusOut: true,
    },
  );

  if (!choice || choice.value === 'current') {
    return [];
  }

  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: l10n.t('Select snapshot roots'),
  });
  return folders ?? [];
}

async function collectTimelineRoots(extraRoots: vscode.Uri[]): Promise<Array<{ id: string; label: string; rootUri: vscode.Uri }>> {
  const result: Array<{ id: string; label: string; rootUri: vscode.Uri }> = [];
  const seen = new Set<string>();

  for (const rootUri of extraRoots) {
    if (seen.has(rootUri.fsPath)) {
      continue;
    }
    seen.add(rootUri.fsPath);
    result.push({
      id: `snapshot::${rootUri.fsPath}`,
      label: path.basename(rootUri.fsPath),
      rootUri,
    });
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const currentRoot = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker');
    if (!seen.has(currentRoot.fsPath)) {
      result.push({
        id: `snapshot::${currentRoot.fsPath}`,
        label: l10n.t('Current'),
        rootUri: currentRoot,
      });
    }
  }

  return result;
}

function flattenSymbols(files: Map<string, CachedFileExport>): Map<string, CachedSymbolEntry> {
  const result = new Map<string, CachedSymbolEntry>();
  for (const [filePath, fileExport] of files) {
    for (const [symbolName, entry] of Object.entries(fileExport.symbols ?? {})) {
      result.set(`${filePath}::${symbolName}`, entry);
    }
  }
  return result;
}

function latestUpdatedAt(entries: CachedSymbolEntry[]): string | undefined {
  return entries
    .map(entry => entry.updatedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
}

async function countStaleEntries(entries: Map<string, CachedSymbolEntry>): Promise<number> {
  let count = 0;
  for (const [key, entry] of entries) {
    const [filePath] = key.split('::');
    if (await hasStaleBlocks(filePath, entry.blocks)) {
      count++;
    }
  }
  return count;
}

async function hasStaleBlocks(filePath: string, blocks: CachedBlock[]): Promise<boolean> {
  if (!blocks.some(block => !!block.blockHash)) {
    return false;
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(resolveFileUri(filePath));
  } catch {
    return true;
  }

  for (const block of blocks) {
    if (!block.blockHash) {
      continue;
    }
    if (computeDocumentBlockHash(document, block.startLine, block.endLine) !== block.blockHash) {
      return true;
    }
  }
  return false;
}

function computeDocumentBlockHash(document: vscode.TextDocument, startLine: number, endLine: number): string {
  const lines: string[] = [];
  const start = Math.max(0, startLine - 1);
  const end = Math.min(document.lineCount - 1, endLine - 1);
  for (let lineIndex = start; lineIndex <= end; lineIndex++) {
    lines.push(document.lineAt(lineIndex).text);
  }
  return `sha256:${require('crypto').createHash('sha256').update(lines.join('\n')).digest('hex')}`;
}

function computeChangeMagnitude(previous: TimelinePoint | undefined, current: TimelinePoint): number {
  if (!previous) {
    return current.blockCount;
  }

  let magnitude = Math.abs(previous.blockCount - current.blockCount);
  if (previous.source !== current.source) {
    magnitude += 1;
  }
  if (previous.stale !== current.stale) {
    magnitude += 1;
  }
  return magnitude;
}

function setupTimelineMessageHandler(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  blockStore: BlockStore,
  cacheService: CacheService,
  restoreFromCache: (editor: vscode.TextEditor, blockStore: BlockStore, cacheService: CacheService) => Promise<boolean>,
  data: TimelineData,
): void {
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === 'compareSnapshots') {
      const snapshotA = data.snapshots.find(snapshot => snapshot.id === message.leftId);
      const snapshotB = data.snapshots.find(snapshot => snapshot.id === message.rightId);
      if (!snapshotA || !snapshotB) {
        return;
      }
      await openComparePanelFromRoots(vscode.Uri.file(snapshotA.rootPath), vscode.Uri.file(snapshotB.rootPath), extensionUri);
      return;
    }

    if (message?.type === 'openSymbol' || message?.type === 'showDetail') {
      const row = data.symbols.find(symbol => symbol.key === message.symbolKey);
      if (!row) {
        return;
      }
      const uri = resolveFileUri(row.filePath);
      const editor = await openFileInEditor(uri);
      await restoreFromCache(editor, blockStore, cacheService);
      const details = blockStore.getBlockDetails(uri, row.symbolName);
      if (message.type === 'showDetail' && details && details.length > 0) {
        await showBlockDetailCommand(blockStore, uri, row.symbolName, 0);
        return;
      }
      if (details && details.length > 0) {
        const firstBlock = details[0].block;
        editor.revealRange(lineRange(editor.document, firstBlock.startLine, firstBlock.endLine), vscode.TextEditorRevealType.InCenter);
      }
    }
  });
}

function buildTimelineHtml(data: TimelineData, webview: vscode.Webview): string {
  const nonce = getNonce();
  const serialized = JSON.stringify(data);
  const strings = JSON.stringify({
    searchSymbols: l10n.t('Search symbols'),
    noSymbols: l10n.t('No timeline symbols found.'),
    selectSymbol: l10n.t('Select a symbol to inspect its timeline.'),
    symbols: l10n.t('Symbols'),
    manual: l10n.t('Manual'),
    auto: l10n.t('Auto'),
    stale: l10n.t('Stale'),
    noWalkthrough: l10n.t('No walkthrough'),
    blocks: l10n.t('Blocks'),
    change: l10n.t('Change'),
    open: l10n.t('Open'),
    detail: l10n.t('Show Detail'),
    compare: l10n.t('Compare'),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeWalker Timeline</title>
<style>
  body {
    margin: 0;
    color: var(--vscode-editor-foreground);
    background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-editor-background) 80%, #0f766e 20%), var(--vscode-editor-background));
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
  }
  .layout {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    min-height: 100vh;
  }
  .sidebar {
    border-right: 1px solid var(--vscode-editorWidget-border);
    padding: 18px;
    background: color-mix(in srgb, var(--vscode-sideBar-background) 84%, black 16%);
  }
  .content {
    padding: 18px;
  }
  input, select, button {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
    color: inherit;
    padding: 10px 12px;
  }
  button { cursor: pointer; }
  .symbol-list {
    margin-top: 12px;
    display: grid;
    gap: 8px;
    max-height: calc(100vh - 100px);
    overflow: auto;
  }
  .symbol-item {
    text-align: left;
  }
  .symbol-item.active {
    outline: 2px solid color-mix(in srgb, var(--vscode-focusBorder) 70%, white 30%);
  }
  .snapshot-bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .snapshot-card, .point-card {
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 16px;
    padding: 14px;
    background: color-mix(in srgb, var(--vscode-editor-background) 78%, black 22%);
  }
  .points {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid currentColor;
  }
  .status.manual { color: #0b7a75; }
  .status.auto { color: #2563eb; }
  .status.none { color: #6b7280; }
  .status.stale { color: #b42318; }
  .compare-bar {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 10px;
    align-items: end;
    margin-top: 18px;
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    padding: 20px;
  }
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <input id="symbolSearch" placeholder="${l10n.t('Search symbols')}">
    <div class="symbol-list" id="symbolList"></div>
  </aside>
  <main class="content">
    <div class="snapshot-bar" id="snapshotBar"></div>
    <section id="timelineBody"></section>
  </main>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const data = ${serialized};
const i18n = ${strings};
const state = { selectedKey: data.symbols[0]?.key || '', search: '' };

function render() {
  renderSymbolList();
  renderSnapshots();
  renderTimeline();
}

function filteredSymbols() {
  const search = state.search.toLowerCase();
  return data.symbols.filter(symbol => {
    if (!search) return true;
    return (symbol.symbolName + ' ' + symbol.filePath).toLowerCase().includes(search);
  });
}

function renderSymbolList() {
  const list = document.getElementById('symbolList');
  const symbols = filteredSymbols();
  list.innerHTML = '';
  if (symbols.length === 0) {
    list.innerHTML = '<div class="empty">' + i18n.noSymbols + '</div>';
    return;
  }
  if (!symbols.some(symbol => symbol.key === state.selectedKey)) {
    state.selectedKey = symbols[0].key;
  }
  for (const symbol of symbols) {
    const button = document.createElement('button');
    button.className = 'symbol-item' + (symbol.key === state.selectedKey ? ' active' : '');
    button.innerHTML = '<strong>' + escapeHtml(symbol.symbolName) + '</strong><br><small>' + escapeHtml(symbol.filePath) + '</small>';
    button.addEventListener('click', () => {
      state.selectedKey = symbol.key;
      render();
    });
    list.appendChild(button);
  }
}

function renderSnapshots() {
  const bar = document.getElementById('snapshotBar');
  bar.innerHTML = '';
  for (const snapshot of data.snapshots) {
    const card = document.createElement('div');
    card.className = 'snapshot-card';
    card.innerHTML = [
      '<strong>' + escapeHtml(snapshot.label) + '</strong>',
      '<p>Symbols: ' + snapshot.symbolCount + '</p>',
      '<p>Manual: ' + snapshot.manualCount + ' / Auto: ' + snapshot.autoCount + '</p>',
      '<p>Stale: ' + snapshot.staleCount + '</p>',
      snapshot.capturedAt ? '<small>' + escapeHtml(snapshot.capturedAt) + '</small>' : '',
    ].join('');
    bar.appendChild(card);
  }
}

function renderTimeline() {
  const body = document.getElementById('timelineBody');
  const symbol = data.symbols.find(item => item.key === state.selectedKey);
  if (!symbol) {
    body.innerHTML = '<div class="empty">' + i18n.selectSymbol + '</div>';
    return;
  }

  const pointCards = symbol.points.map((point, index) => {
    const snapshot = data.snapshots.find(item => item.id === point.snapshotId);
    const classes = ['status', point.source];
    if (point.stale) classes.push('stale');
    return '<div class="point-card">' +
      '<strong>' + escapeHtml(snapshot?.label || point.snapshotId) + '</strong>' +
      '<p><span class="' + classes.join(' ') + '">' + escapeHtml(point.source === 'none' ? i18n.noWalkthrough : (point.source === 'manual' ? i18n.manual : i18n.auto)) + (point.stale ? ' • ' + i18n.stale.toUpperCase() : '') + '</span></p>' +
      '<p>' + i18n.blocks + ': ' + point.blockCount + '</p>' +
      '<p>' + i18n.change + ': ' + point.changeMagnitude + '</p>' +
      (point.updatedAt ? '<small>' + escapeHtml(point.updatedAt) + '</small>' : '<small>' + i18n.noWalkthrough + '</small>') +
      (index === symbol.points.length - 1 ? '<div style="margin-top:12px;display:flex;gap:8px;"><button data-action="open">' + i18n.open + '</button><button data-action="detail">' + i18n.detail + '</button></div>' : '') +
      '</div>';
  }).join('');

  const options = data.snapshots.map(snapshot => '<option value="' + snapshot.id + '">' + escapeHtml(snapshot.label) + '</option>').join('');

  body.innerHTML = [
    '<h2>' + escapeHtml(symbol.symbolName) + '</h2>',
    '<p>' + escapeHtml(symbol.filePath) + '</p>',
    '<div class="points">' + pointCards + '</div>',
    '<div class="compare-bar">',
    '<select id="leftSnapshot">' + options + '</select>',
    '<select id="rightSnapshot">' + options + '</select>',
    '<button id="compareButton">' + i18n.compare + '</button>',
    '</div>',
  ].join('');

  body.querySelector('[data-action="open"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSymbol', symbolKey: symbol.key });
  });
  body.querySelector('[data-action="detail"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'showDetail', symbolKey: symbol.key });
  });
  body.querySelector('#compareButton')?.addEventListener('click', () => {
    vscode.postMessage({
      type: 'compareSnapshots',
      leftId: body.querySelector('#leftSnapshot').value,
      rightId: body.querySelector('#rightSnapshot').value,
    });
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('symbolSearch').addEventListener('input', (event) => {
  state.search = event.target.value;
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
