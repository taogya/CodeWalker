import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { log } from '@utils/logger';

export type RepairCandidateStrategy = 'definition-shift' | 'block-hash-match' | 'nearby-search';

export interface RepairPreviewCandidate {
  id: string;
  strategy: RepairCandidateStrategy;
  startLine: number;
  endLine: number;
  summary: string;
  reason: string;
  keepsExplanation: boolean;
  keepsAnnotations: boolean;
  canApply: boolean;
}

export interface RepairPreviewData {
  filePath: string;
  symbolName: string;
  blockLabel: string;
  blockIndex: number;
  source: 'manual' | 'auto';
  oldStartLine: number;
  oldEndLine: number;
  codeStartLine: number;
  currentCode: string;
  candidates: RepairPreviewCandidate[];
  selectedCandidateId?: string;
}

interface RepairPreviewHandlers {
  onApplyCandidate: (candidateId: string) => Promise<void>;
  onOpenCandidate: (candidateId: string) => Promise<void>;
  onOpenEdit: () => Promise<void>;
}

interface SelectCandidateMessage {
  type: 'selectCandidate';
  candidateId: string;
}

interface ApplyCandidateMessage {
  type: 'applyCandidate';
}

interface OpenCandidateMessage {
  type: 'openCandidate';
}

interface OpenEditMessage {
  type: 'openEdit';
}

type RepairPreviewMessage =
  | SelectCandidateMessage
  | ApplyCandidateMessage
  | OpenCandidateMessage
  | OpenEditMessage;

let previewPanel: vscode.WebviewPanel | undefined;
let currentData: RepairPreviewData | undefined;
let currentHandlers: RepairPreviewHandlers | undefined;
let currentDisposable: vscode.Disposable | undefined;

export function showRepairPreviewPanel(
  data: RepairPreviewData,
  handlers: RepairPreviewHandlers,
): void {
  const selectedCandidateId = data.selectedCandidateId ?? data.candidates[0]?.id;
  currentData = {
    ...data,
    candidates: data.candidates.map(candidate => ({ ...candidate })),
    selectedCandidateId,
  };
  currentHandlers = handlers;

  log('repairPreviewPanel.show', {
    filePath: data.filePath,
    symbolName: data.symbolName,
    blockIndex: data.blockIndex,
    candidateCount: data.candidates.length,
    selectedCandidateId,
    reusingPanel: !!previewPanel,
  });

  if (previewPanel) {
    previewPanel.title = l10n.t('CodeWalker: Repair Preview');
    previewPanel.webview.html = buildHtml(currentData);
    setupMessageHandler(previewPanel);
    previewPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  previewPanel = vscode.window.createWebviewPanel(
    'codeWalkerRepairPreview',
    l10n.t('CodeWalker: Repair Preview'),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true },
  );

  previewPanel.webview.html = buildHtml(currentData);
  setupMessageHandler(previewPanel);

  previewPanel.onDidDispose(() => {
    log('repairPreviewPanel.dispose');
    currentDisposable?.dispose();
    currentDisposable = undefined;
    previewPanel = undefined;
    currentData = undefined;
    currentHandlers = undefined;
  });
}

export function disposeRepairPreviewPanel(): void {
  currentDisposable?.dispose();
  currentDisposable = undefined;
  previewPanel?.dispose();
  previewPanel = undefined;
  currentData = undefined;
  currentHandlers = undefined;
}

export function __getCurrentRepairPreviewData(): RepairPreviewData | undefined {
  if (!currentData) {
    return undefined;
  }
  return {
    ...currentData,
    candidates: currentData.candidates.map(candidate => ({ ...candidate })),
  };
}

export async function __applyRepairPreviewCandidateForTest(candidateId?: string): Promise<void> {
  const resolvedCandidateId = resolveSelectedCandidateId(candidateId);
  if (!resolvedCandidateId || !currentHandlers) {
    return;
  }
  await currentHandlers.onApplyCandidate(resolvedCandidateId);
  disposeRepairPreviewPanel();
}

function setupMessageHandler(panel: vscode.WebviewPanel): void {
  currentDisposable?.dispose();
  currentDisposable = panel.webview.onDidReceiveMessage(async (message: RepairPreviewMessage) => {
    if (!currentData) {
      return;
    }

    if (message.type === 'selectCandidate') {
      currentData.selectedCandidateId = message.candidateId;
      return;
    }

    const selectedCandidateId = resolveSelectedCandidateId();
    if (!selectedCandidateId || !currentHandlers) {
      return;
    }

    if (message.type === 'openCandidate') {
      await currentHandlers.onOpenCandidate(selectedCandidateId);
      return;
    }

    if (message.type === 'applyCandidate') {
      await currentHandlers.onApplyCandidate(selectedCandidateId);
      disposeRepairPreviewPanel();
      return;
    }

    if (message.type === 'openEdit') {
      await currentHandlers.onOpenEdit();
      disposeRepairPreviewPanel();
    }
  });
}

function resolveSelectedCandidateId(candidateId?: string): string | undefined {
  if (candidateId) {
    return candidateId;
  }
  if (currentData?.selectedCandidateId) {
    return currentData.selectedCandidateId;
  }
  return currentData?.candidates[0]?.id;
}

function buildHtml(data: RepairPreviewData): string {
  const nonce = getNonce();
  const payload = serializeForScript(data);
  const strings = serializeForScript({
    noCandidates: l10n.t('No repair candidates available.'),
    canApplyNow: l10n.t('Can apply now'),
    reviewOnly: l10n.t('Review only'),
    candidateRange: l10n.t('Candidate range'),
    keepsExplanation: l10n.t('Explanation kept'),
    keepsAnnotations: l10n.t('Annotations kept'),
    definitionShift: l10n.t('Definition shift'),
    blockHashMatch: l10n.t('Block hash match'),
    nearbySearch: l10n.t('Nearby search'),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(l10n.t('CodeWalker: Repair Preview'))}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--vscode-editor-background);
    --panel: color-mix(in srgb, var(--bg) 88%, black 12%);
    --border: var(--vscode-editorWidget-border);
    --text: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --accent: color-mix(in srgb, var(--vscode-focusBorder) 80%, white 20%);
    --review: #9c5c00;
    --apply: #0b7a75;
    --old: #b42318;
  }
  body {
    margin: 0;
    color: var(--text);
    background: linear-gradient(140deg, color-mix(in srgb, var(--bg) 82%, #0f766e 18%), var(--bg));
    font-family: 'Segoe UI', sans-serif;
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 280px;
    min-height: 100vh;
  }
  .pane, .actions {
    padding: 18px;
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 94%, white 6%);
  }
  .pane:first-child {
    border-left: 0;
  }
  h2, p {
    margin-top: 0;
  }
  .meta {
    color: var(--muted);
    margin-bottom: 14px;
  }
  .code-frame {
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: auto;
    background: color-mix(in srgb, var(--bg) 92%, black 8%);
    max-height: calc(100vh - 170px);
  }
  .code-line {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
    padding: 0 14px;
    white-space: pre;
    font-family: 'SF Mono', Consolas, monospace;
    line-height: 1.6;
  }
  .line-no {
    color: var(--muted);
    text-align: right;
    user-select: none;
  }
  .code-line.old-range {
    background: color-mix(in srgb, var(--old) 14%, transparent 86%);
  }
  .code-line.candidate-range {
    background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
  }
  .code-line.old-range.candidate-range {
    background: linear-gradient(90deg, color-mix(in srgb, var(--old) 14%, transparent 86%), color-mix(in srgb, var(--accent) 18%, transparent 82%));
  }
  .candidate-list {
    display: grid;
    gap: 10px;
    max-height: calc(100vh - 170px);
    overflow: auto;
  }
  .candidate {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px;
    background: color-mix(in srgb, var(--bg) 88%, white 12%);
    cursor: pointer;
  }
  .candidate.selected {
    outline: 2px solid var(--accent);
  }
  .candidate-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .badge {
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
  }
  .badge.apply {
    color: var(--apply);
  }
  .badge.review {
    color: var(--review);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  button {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg) 88%, white 12%);
    color: var(--text);
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .empty {
    color: var(--muted);
    padding: 20px;
    border: 1px dashed var(--border);
    border-radius: 14px;
  }
  .strategy {
    color: var(--muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .range {
    color: var(--muted);
    font-size: 13px;
  }
  .source-chip {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    margin-top: 8px;
  }
  .action-note {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }
  @media (max-width: 1100px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .pane, .actions {
      border-left: 0;
      border-top: 1px solid var(--border);
    }
  }
</style>
</head>
<body>
<div class="shell">
  <section class="pane">
    <h2>${escapeHtml(l10n.t('Current Symbol'))}</h2>
    <div class="meta">${escapeHtml(data.filePath)} :: ${escapeHtml(data.symbolName)}</div>
    <div class="code-frame" id="codeFrame"></div>
  </section>
  <section class="pane">
    <h2>${escapeHtml(l10n.t('Repair Candidates'))}</h2>
    <div class="meta">${escapeHtml(l10n.t('Repair Block'))}: ${escapeHtml(data.blockLabel)} (L${data.oldStartLine}-L${data.oldEndLine})</div>
    <div class="candidate-list" id="candidateList"></div>
  </section>
  <aside class="actions">
    <div>
      <h2>${escapeHtml(l10n.t('CodeWalker: Repair Preview'))}</h2>
      <p>${escapeHtml(data.blockLabel)}</p>
      <div class="source-chip">${escapeHtml(data.source === 'manual' ? l10n.t('Manual') : l10n.t('Auto'))}</div>
    </div>
    <button id="applyButton">${escapeHtml(l10n.t('Apply Selected Candidate'))}</button>
    <button id="openButton">${escapeHtml(l10n.t('Open Selected Candidate'))}</button>
    <button id="editButton">${escapeHtml(l10n.t('Continue in Edit/Import'))}</button>
    <p class="action-note">${escapeHtml(l10n.t('Apply is enabled only for candidates that can be accepted without rewriting the block content.'))}</p>
  </aside>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const data = ${payload};
const i18n = ${strings};
const state = {
  selectedCandidateId: data.selectedCandidateId || data.candidates[0]?.id,
};

function strategyLabel(strategy) {
  if (strategy === 'definition-shift') return i18n.definitionShift;
  if (strategy === 'block-hash-match') return i18n.blockHashMatch;
  return i18n.nearbySearch;
}

function renderCode() {
  const container = document.getElementById('codeFrame');
  const selected = data.candidates.find(candidate => candidate.id === state.selectedCandidateId);
  const lines = data.currentCode.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = data.codeStartLine + index;
    const isOldRange = lineNumber >= data.oldStartLine && lineNumber <= data.oldEndLine;
    const isCandidateRange = selected && lineNumber >= selected.startLine && lineNumber <= selected.endLine;
    const classes = ['code-line'];
    if (isOldRange) classes.push('old-range');
    if (isCandidateRange) classes.push('candidate-range');
    rows.push('<div class="' + classes.join(' ') + '"><span class="line-no">' + String(lineNumber).padStart(3, ' ') + '</span><span>' + escapeHtml(lines[index] || ' ') + '</span></div>');
  }
  container.innerHTML = rows.join('');
}

function renderCandidates() {
  const container = document.getElementById('candidateList');
  if (data.candidates.length === 0) {
    container.innerHTML = '<div class="empty">' + i18n.noCandidates + '</div>';
    return;
  }

  container.innerHTML = data.candidates.map(candidate => {
    const selected = candidate.id === state.selectedCandidateId ? ' selected' : '';
    const badges = [
      '<span class="badge ' + (candidate.canApply ? 'apply' : 'review') + '">' + (candidate.canApply ? i18n.canApplyNow : i18n.reviewOnly) + '</span>',
      '<span class="badge review">' + i18n.candidateRange + ': L' + candidate.startLine + '-L' + candidate.endLine + '</span>',
      candidate.keepsExplanation ? '<span class="badge apply">' + i18n.keepsExplanation + '</span>' : '',
      candidate.keepsAnnotations ? '<span class="badge apply">' + i18n.keepsAnnotations + '</span>' : '',
    ].filter(Boolean).join('');

    return [
      '<div class="candidate' + selected + '" data-candidate-id="' + escapeHtml(candidate.id) + '">',
      '<div class="candidate-header">',
      '<div>',
      '<div class="strategy">' + escapeHtml(strategyLabel(candidate.strategy)) + '</div>',
      '<strong>' + escapeHtml(candidate.summary) + '</strong>',
      '</div>',
      '<div class="range">L' + candidate.startLine + '-L' + candidate.endLine + '</div>',
      '</div>',
      '<p>' + escapeHtml(candidate.reason) + '</p>',
      '<div class="badges">' + badges + '</div>',
      '</div>',
    ].join('');
  }).join('');

  for (const element of document.querySelectorAll('[data-candidate-id]')) {
    element.addEventListener('click', () => {
      state.selectedCandidateId = element.getAttribute('data-candidate-id');
      vscode.postMessage({ type: 'selectCandidate', candidateId: state.selectedCandidateId });
      render();
    });
  }
}

function renderActions() {
  const selected = data.candidates.find(candidate => candidate.id === state.selectedCandidateId);
  document.getElementById('applyButton').disabled = !selected || !selected.canApply;
}

function render() {
  renderCode();
  renderCandidates();
  renderActions();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('applyButton').addEventListener('click', () => {
  const selected = data.candidates.find(candidate => candidate.id === state.selectedCandidateId);
  if (!selected || !selected.canApply) {
    return;
  }
  vscode.postMessage({ type: 'applyCandidate' });
});
document.getElementById('openButton').addEventListener('click', () => {
  vscode.postMessage({ type: 'openCandidate' });
});
document.getElementById('editButton').addEventListener('click', () => {
  vscode.postMessage({ type: 'openEdit' });
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

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}