/**
 * compareWalkthroughs.ts — ウォークスルー比較コマンド
 *
 * ユーザー管理のバックアップフォルダと現在のキャッシュを比較し、
 * シンボル/ブロック単位の差分を Webview で表示する。
 *
 * 対象 A: デフォルトは現在の .code-walker/ (変更可)
 * 対象 B: ユーザーがフォルダ選択 (必須)
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { CachedFileExport, CachedBlock, CachedSymbolEntry } from '@cache/cacheTypes';
import { readAllCacheFilesFromRoot } from '@cache/cacheSnapshot';
import { log } from '@utils/logger';
import { notifyError, notifyWarning } from '@utils/notifications';

// ── 差分データ型 ───────────────────────────────

type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

interface BlockDiff {
  status: DiffStatus;
  label: string;
  aBlock?: CachedBlock;
  bBlock?: CachedBlock;
  changes: string[];
}

interface SymbolDiff {
  symbolName: string;
  status: DiffStatus;
  blocks: BlockDiff[];
}

interface FileDiff {
  filePath: string;
  status: DiffStatus;
  symbols: SymbolDiff[];
}

// ── コマンドハンドラ ──────────────────────────────

export async function compareWalkthroughsCommand(
  extensionUri: vscode.Uri,
): Promise<void> {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!wsRoot) {
    void notifyWarning(l10n.t('CodeWalker: No workspace is open.'));
    return;
  }

  const defaultCacheDir = vscode.Uri.joinPath(wsRoot, '.code-walker');

  // ── 対象 A 選択 ─────────────────────────────
  const targetAChoice = await vscode.window.showQuickPick(
    [
      { label: l10n.t('$(folder) Current cache (.code-walker/)'), value: 'default' },
      { label: l10n.t('$(folder-opened) Select folder...'), value: 'browse' },
    ],
    {
      title: l10n.t('CodeWalker: Compare — Target A'),
      placeHolder: l10n.t('Select the first comparison target'),
    },
  );
  if (!targetAChoice) { return; }

  let targetA: vscode.Uri;
  if (targetAChoice.value === 'default') {
    targetA = defaultCacheDir;
  } else {
    const folders = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: l10n.t('Select Target A'),
      defaultUri: defaultCacheDir,
    });
    if (!folders || folders.length === 0) { return; }
    targetA = folders[0];
  }

  // ── 対象 B 選択 ─────────────────────────────
  const foldersB = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: l10n.t('Select Target B'),
    defaultUri: defaultCacheDir,
    title: l10n.t('CodeWalker: Compare — Target B'),
  });
  if (!foldersB || foldersB.length === 0) { return; }
  const targetB = foldersB[0];

  // ── キャッシュ読込 & 差分算出 ────────────────
  await openComparePanelFromRoots(targetA, targetB, extensionUri);
}

export async function openComparePanelFromRoots(
  targetA: vscode.Uri,
  targetB: vscode.Uri,
  extensionUri: vscode.Uri,
): Promise<void> {
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n.t('CodeWalker: Comparing...') },
    async () => {
      try {
        const cacheA = await readAllCacheFilesFromRoot(targetA);
        const cacheB = await readAllCacheFilesFromRoot(targetB);
        const diffs = computeDiff(cacheA, cacheB);
        showComparePanel(diffs, targetA, targetB, extensionUri);
        log('compareWalkthroughs completed', { filesA: cacheA.size, filesB: cacheB.size, diffs: diffs.length });
      } catch (err) {
        void notifyError(l10n.t('CodeWalker: Compare failed — {0}', String(err)));
        log('compareWalkthroughs failed', { error: String(err) });
      }
    },
  );
}

// ── 差分算出 ──────────────────────────────────────

function computeDiff(
  cacheA: Map<string, CachedFileExport>,
  cacheB: Map<string, CachedFileExport>,
): FileDiff[] {
  const allKeys = new Set([...cacheA.keys(), ...cacheB.keys()]);
  const diffs: FileDiff[] = [];

  for (const key of [...allKeys].sort()) {
    const a = cacheA.get(key);
    const b = cacheB.get(key);
    const filePath = a?.filePath ?? b?.filePath ?? key;

    if (a && !b) {
      // A のみ — B で削除
      diffs.push({ filePath, status: 'removed', symbols: symbolsToRemoved(a.symbols) });
    } else if (!a && b) {
      // B のみ — B で追加
      diffs.push({ filePath, status: 'added', symbols: symbolsToAdded(b.symbols) });
    } else if (a && b) {
      // 両方存在 — シンボル比較
      const symbols = diffSymbols(a.symbols, b.symbols);
      const hasChange = symbols.some(s => s.status !== 'unchanged');
      if (hasChange) {
        diffs.push({ filePath, status: 'changed', symbols });
      }
    }
  }

  return diffs;
}

function symbolsToRemoved(symbols: Record<string, CachedSymbolEntry>): SymbolDiff[] {
  return Object.entries(symbols).map(([name, entry]) => ({
    symbolName: name,
    status: 'removed' as DiffStatus,
    blocks: entry.blocks.map(b => ({ status: 'removed' as DiffStatus, label: b.label, aBlock: b, changes: [] })),
  }));
}

function symbolsToAdded(symbols: Record<string, CachedSymbolEntry>): SymbolDiff[] {
  return Object.entries(symbols).map(([name, entry]) => ({
    symbolName: name,
    status: 'added' as DiffStatus,
    blocks: entry.blocks.map(b => ({ status: 'added' as DiffStatus, label: b.label, bBlock: b, changes: [] })),
  }));
}

function diffSymbols(
  aSymbols: Record<string, CachedSymbolEntry>,
  bSymbols: Record<string, CachedSymbolEntry>,
): SymbolDiff[] {
  const allNames = new Set([...Object.keys(aSymbols), ...Object.keys(bSymbols)]);
  const result: SymbolDiff[] = [];

  for (const name of [...allNames].sort()) {
    const a = aSymbols[name];
    const b = bSymbols[name];

    if (a && !b) {
      result.push({
        symbolName: name,
        status: 'removed',
        blocks: a.blocks.map(bl => ({ status: 'removed' as DiffStatus, label: bl.label, aBlock: bl, changes: [] })),
      });
    } else if (!a && b) {
      result.push({
        symbolName: name,
        status: 'added',
        blocks: b.blocks.map(bl => ({ status: 'added' as DiffStatus, label: bl.label, bBlock: bl, changes: [] })),
      });
    } else if (a && b) {
      const blocks = diffBlocks(a.blocks, b.blocks);
      const hasChange = blocks.some(bl => bl.status !== 'unchanged');
      result.push({
        symbolName: name,
        status: hasChange ? 'changed' : 'unchanged',
        blocks,
      });
    }
  }

  return result;
}

function diffBlocks(aBlocks: CachedBlock[], bBlocks: CachedBlock[]): BlockDiff[] {
  const result: BlockDiff[] = [];
  const maxLen = Math.max(aBlocks.length, bBlocks.length);

  for (let i = 0; i < maxLen; i++) {
    const a = aBlocks[i];
    const b = bBlocks[i];

    if (a && !b) {
      result.push({ status: 'removed', label: a.label, aBlock: a, changes: [] });
    } else if (!a && b) {
      result.push({ status: 'added', label: b.label, bBlock: b, changes: [] });
    } else if (a && b) {
      const changes: string[] = [];
      if (a.label !== b.label) { changes.push(`label: "${a.label}" → "${b.label}"`); }
      if (a.startLine !== b.startLine) { changes.push(`startLine: ${a.startLine} → ${b.startLine}`); }
      if (a.endLine !== b.endLine) { changes.push(`endLine: ${a.endLine} → ${b.endLine}`); }
      if (a.description !== b.description) { changes.push(`description changed`); }
      if (a.colorIndex !== b.colorIndex) { changes.push(`color: ${a.colorIndex} → ${b.colorIndex}`); }
      if ((a.explanation ?? '') !== (b.explanation ?? '')) { changes.push('explanation changed'); }

      result.push({
        status: changes.length > 0 ? 'changed' : 'unchanged',
        label: b.label,
        aBlock: a,
        bBlock: b,
        changes,
      });
    }
  }

  return result;
}

// ── 比較パネル表示 ─────────────────────────────────

let comparePanel: vscode.WebviewPanel | undefined;

function showComparePanel(
  diffs: FileDiff[],
  targetA: vscode.Uri,
  targetB: vscode.Uri,
  extensionUri: vscode.Uri,
): void {
  if (comparePanel) {
    comparePanel.webview.html = buildCompareHtml(diffs, targetA, targetB, comparePanel.webview, extensionUri);
    comparePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  comparePanel = vscode.window.createWebviewPanel(
    'codeWalkerCompare',
    l10n.t('CodeWalker: Compare'),
    vscode.ViewColumn.One,
    {
      enableScripts: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    },
  );

  comparePanel.webview.html = buildCompareHtml(diffs, targetA, targetB, comparePanel.webview, extensionUri);

  comparePanel.onDidDispose(() => {
    comparePanel = undefined;
  });
}

export function disposeComparePanel(): void {
  comparePanel?.dispose();
  comparePanel = undefined;
}

// ── HTML 構築 ─────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_ICONS: Record<DiffStatus, string> = {
  added: '🟢',
  removed: '🔴',
  changed: '🟡',
  unchanged: '⚪',
};

function buildCompareHtml(
  diffs: FileDiff[],
  targetA: vscode.Uri,
  targetB: vscode.Uri,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const sharedCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'shared.css'));

  const labelA = targetA.path.split('/').slice(-2).join('/');
  const labelB = targetB.path.split('/').slice(-2).join('/');

  const summary = {
    added: diffs.filter(d => d.status === 'added').length,
    removed: diffs.filter(d => d.status === 'removed').length,
    changed: diffs.filter(d => d.status === 'changed').length,
  };

  let content = '';

  if (diffs.length === 0) {
    content = `<div class="hint"><p>${l10n.t('No differences found.')}</p></div>`;
  } else {
    for (const file of diffs) {
      content += `<div class="file-diff">
        <h3>${STATUS_ICONS[file.status]} ${escapeHtml(file.filePath)}</h3>`;

      for (const sym of file.symbols) {
        if (sym.status === 'unchanged') { continue; }
        content += `<div class="symbol-diff">
          <h4>${STATUS_ICONS[sym.status]} ${escapeHtml(sym.symbolName)}</h4>
          <table class="diff-table">
            <thead>
              <tr>
                <th></th>
                <th>${l10n.t('Block')}</th>
                <th>${l10n.t('Range')}</th>
                <th>${l10n.t('Changes')}</th>
              </tr>
            </thead>
            <tbody>`;

        for (const block of sym.blocks) {
          if (block.status === 'unchanged') { continue; }
          const range = block.bBlock
            ? `L${block.bBlock.startLine}-L${block.bBlock.endLine}`
            : block.aBlock
              ? `L${block.aBlock.startLine}-L${block.aBlock.endLine}`
              : '';
          const changes = block.changes.length > 0
            ? block.changes.map(c => escapeHtml(c)).join('<br>')
            : block.status === 'added' ? l10n.t('New block')
            : block.status === 'removed' ? l10n.t('Deleted')
            : '';

          content += `<tr class="diff-${block.status}">
            <td>${STATUS_ICONS[block.status]}</td>
            <td>${escapeHtml(block.label)}</td>
            <td class="range">${range}</td>
            <td>${changes}</td>
          </tr>`;
        }

        content += `</tbody></table></div>`;
      }

      content += `</div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${sharedCss}">
<style>
  body { padding: 16px; font-family: var(--vscode-editor-font-family, monospace); }
  h2 { margin-top: 0; }
  .summary { display: flex; gap: 16px; margin-bottom: 20px; padding: 12px; background: var(--vscode-editor-background); border-radius: 6px; }
  .summary-item { display: flex; align-items: center; gap: 4px; font-size: 14px; }
  .targets { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  .file-diff { margin-bottom: 24px; }
  .file-diff h3 { margin: 0 0 8px 0; font-size: 14px; }
  .symbol-diff { margin-left: 16px; margin-bottom: 16px; }
  .symbol-diff h4 { margin: 0 0 6px 0; font-size: 13px; }
  .diff-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .diff-table th, .diff-table td { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
  .diff-table th { font-weight: 600; background: var(--vscode-editor-background); }
  .diff-added { background: rgba(52, 168, 83, 0.08); }
  .diff-removed { background: rgba(219, 68, 55, 0.08); }
  .diff-changed { background: rgba(234, 134, 0, 0.08); }
  .range { white-space: nowrap; font-family: monospace; }
  .hint { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <h2>${l10n.t('CodeWalker: Compare')}</h2>
  <div class="targets">
    <strong>A:</strong> ${escapeHtml(labelA)}<br>
    <strong>B:</strong> ${escapeHtml(labelB)}
  </div>
  <div class="summary">
    <span class="summary-item">🟢 ${l10n.t('Added')}: ${summary.added}</span>
    <span class="summary-item">🔴 ${l10n.t('Removed')}: ${summary.removed}</span>
    <span class="summary-item">🟡 ${l10n.t('Changed')}: ${summary.changed}</span>
  </div>
  ${content}
</body>
</html>`;
}
