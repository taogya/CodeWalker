/**
 * blockEditPanel.ts — ブロック編集 Webview パネル
 *
 * Manual モードでブロックを追加・編集するための Webview。
 * ラベル、行範囲、色選択(6色)、概要、解説、アノテーションを入力し、
 * 保存で walks-manual/ に書き込む。
 * プレビューボタンでエディタ上にハイライトを仮表示する。
 *
 * L2 リファクタリング: CSS/JS を media/ に外部化。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { toCacheRelPath, computeBlockHash } from '@utils/fileUtils';
import { buildSymbolOwnerKey, highlightBlocks, setAnnotations, clearSymbol, type BlockRange, type LineAnnotation } from './highlighter';
import type { BlockStore } from './blockStore';
import type { BlockInfo } from '@analysis/contextBuilder';
import { CacheService } from '@cache/cacheService';
import type { CachedFileExport, CachedBlock, CacheSource } from '@cache/cacheTypes';
import { loadConfig } from '@cache/configReader';
import { log } from '@utils/logger';
import { notifyError, notifyInfo } from '@utils/notifications';

/** 編集パネルに渡す初期データ */
export interface BlockEditInitData {
  /** ファイル URI */
  fileUri: vscode.Uri;
  /** シンボル名（既存ブロック編集時。新規なら空文字） */
  symbolName: string;
  /** ブロックインデックス（既存編集時。新規なら -1） */
  blockIndex: number;
  /** 初期値: ラベル */
  label: string;
  /** 初期値: 開始行 (1-based) */
  startLine: number;
  /** 初期値: 終了行 (1-based) */
  endLine: number;
  /** 初期値: 色インデックス (0-5) */
  colorIndex: number;
  /** 初期値: 概要 */
  description: string;
  /** 初期値: 解説 (Markdown) */
  explanation: string;
  /** 初期値: アノテーション */
  annotations: { line: number; text: string }[];
  /** Auto からのインポートか */
  isImport: boolean;
  /** 編集対象ブロックの source */
  source?: CacheSource;
  /** 編集対象ブロックの source 内 index */
  sourceBlockIndex?: number;
}

const PALETTE = [
  { name: 'Blue', hex: '#4285F4' },
  { name: 'Green', hex: '#34A853' },
  { name: 'Purple', hex: '#9A4DCA' },
  { name: 'Orange', hex: '#EA8600' },
  { name: 'Red', hex: '#DB4437' },
  { name: 'Cyan', hex: '#00ACC1' },
];

let editPanel: vscode.WebviewPanel | undefined;
let currentInitData: BlockEditInitData | undefined;
let currentBlockStore: BlockStore | undefined;
let currentCacheService: CacheService | undefined;
let currentOnSaved: (() => void) | undefined;

/**
 * ブロック編集パネルを開く。
 */
export function showBlockEditPanel(
  data: BlockEditInitData,
  blockStore: BlockStore,
  cacheService: CacheService,
  extensionUri: vscode.Uri,
  onSaved?: () => void,
): void {
  log('showBlockEditPanel', {
    fileUri: data.fileUri.toString(),
    symbolName: data.symbolName,
    blockIndex: data.blockIndex,
    label: data.label,
    startLine: data.startLine,
    endLine: data.endLine,
    colorIndex: data.colorIndex,
    isImport: data.isImport,
    annotationCount: data.annotations.length,
    reusingPanel: !!editPanel,
  });
  currentInitData = data;
  currentBlockStore = blockStore;
  currentCacheService = cacheService;
  currentOnSaved = onSaved;

  if (editPanel) {
    editPanel.webview.html = buildEditHtml(data, editPanel.webview, extensionUri);
    editPanel.reveal(vscode.ViewColumn.Beside, true);
    setupMessageHandler(editPanel, data, blockStore, cacheService, onSaved);
    return;
  }

  editPanel = vscode.window.createWebviewPanel(
    'codeWalkerBlockEdit',
    l10n.t('CodeWalker: Edit Block'),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    },
  );

  editPanel.webview.html = buildEditHtml(data, editPanel.webview, extensionUri);
  setupMessageHandler(editPanel, data, blockStore, cacheService, onSaved);

  editPanel.onDidDispose(() => {
    log('blockEditPanel: disposed');
    // プレビュー用ハイライトが残っていればクリア
    if (currentInitData) {
      try {
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === currentInitData!.fileUri.toString(),
        );
        if (editor) {
          clearSymbol(editor, '__preview__');
        }
      } catch { /* ignore */ }
    }
    editPanel = undefined;
    currentInitData = undefined;
    currentBlockStore = undefined;
    currentCacheService = undefined;
    currentOnSaved = undefined;
  });
}

export function disposeBlockEditPanel(): void {
  editPanel?.dispose();
  editPanel = undefined;
  currentInitData = undefined;
  currentBlockStore = undefined;
  currentCacheService = undefined;
  currentOnSaved = undefined;
}

export function __getCurrentEditInitData(): BlockEditInitData | undefined {
  if (!currentInitData) { return undefined; }
  return {
    ...currentInitData,
    annotations: currentInitData.annotations.map(annotation => ({ ...annotation })),
  };
}

export async function __saveCurrentEditPanelForTest(
  message: Omit<SaveMessage, 'type'>,
): Promise<void> {
  if (!currentInitData || !currentBlockStore || !currentCacheService) {
    return;
  }

  await handleSave(currentInitData, { type: 'save', ...message }, currentBlockStore, currentCacheService);
  currentOnSaved?.();
  disposeBlockEditPanel();
}

// ─── メッセージハンドラ ─────────────────────────────

/** Webview → Extension メッセージ */
interface SaveMessage {
  type: 'save';
  symbolName: string;
  label: string;
  startLine: number;
  endLine: number;
  colorIndex: number;
  description: string;
  explanation: string;
  annotations: { line: number; text: string }[];
}

interface PreviewMessage {
  type: 'preview';
  startLine: number;
  endLine: number;
  colorIndex: number;
  annotations: { line: number; text: string }[];
}

interface RequestLabelsMessage {
  type: 'requestLabels';
}

type EditMessage = SaveMessage | PreviewMessage | RequestLabelsMessage;

let currentDisposable: vscode.Disposable | undefined;

function setupMessageHandler(
  panel: vscode.WebviewPanel,
  initData: BlockEditInitData,
  blockStore: BlockStore,
  cacheService: CacheService,
  onSaved?: () => void,
): void {
  // 前回のハンドラを破棄
  currentDisposable?.dispose();

  currentDisposable = panel.webview.onDidReceiveMessage(async (msg: EditMessage) => {
    log('blockEditPanel: message received', { type: msg.type });
    if (msg.type === 'requestLabels') {
      const config = loadConfig();
      log('blockEditPanel: sending labels', { labelCount: config.templateLabels.length });
      panel.webview.postMessage({ type: 'labels', labels: config.templateLabels });
      return;
    }

    if (msg.type === 'preview') {
      log('blockEditPanel: preview requested', { startLine: msg.startLine, endLine: msg.endLine, colorIndex: msg.colorIndex, annotationCount: msg.annotations.length });
      await handlePreview(initData.fileUri, msg);
      return;
    }

    if (msg.type === 'save') {
      log('blockEditPanel: save requested', { symbolName: msg.symbolName, label: msg.label, startLine: msg.startLine, endLine: msg.endLine, colorIndex: msg.colorIndex, annotationCount: msg.annotations.length });
      await handleSave(initData, msg, blockStore, cacheService);
      onSaved?.();
      panel.dispose();
    }
  });
}

async function handlePreview(fileUri: vscode.Uri, msg: PreviewMessage): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });
    const startLine = Math.max(0, msg.startLine - 1);
    const endLine = Math.min(doc.lineCount - 1, msg.endLine - 1);
    const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);

    highlightBlocks(editor, [{ range, colorIndex: msg.colorIndex }], '__preview__');

    const annots: LineAnnotation[] = msg.annotations.map(a => ({ line: a.line, text: a.text }));
    setAnnotations(editor, annots, '__preview__');

    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    log('blockEditPanel: preview applied');
  } catch (err) {
    log('blockEditPanel: preview failed', { error: String(err) });
  }
}

async function handleSave(
  initData: BlockEditInitData,
  msg: SaveMessage,
  blockStore: BlockStore,
  cacheService: CacheService,
): Promise<void> {
  log('handleSave start', { symbolName: msg.symbolName, label: msg.label, blockIndex: initData.blockIndex, isImport: initData.isImport });
  if (!cacheService.hasWorkspace()) {
    log('handleSave: no workspace');
    void notifyError(l10n.t('CodeWalker: No workspace is open.'));
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(initData.fileUri, false);
  const cacheRelPath = toCacheRelPath(relativePath);

  // 既存 JSON 読込
  let fileExport: CachedFileExport;
  const existing = await cacheService.readFile('walks-manual', cacheRelPath);
  fileExport = existing ?? { version: '1.0', filePath: relativePath, symbols: {} };

  // シンボルエントリを取得/作成
  const symName = msg.symbolName || initData.symbolName || msg.label;
  let symbolEntry = fileExport.symbols[symName];
  if (!symbolEntry) {
    symbolEntry = {
      symbolName: symName,
      overview: msg.description || '',
      updatedAt: new Date().toISOString(),
      source: 'manual',
      blocks: [],
    };
    fileExport.symbols[symName] = symbolEntry;
  }
  symbolEntry.updatedAt = new Date().toISOString();
  symbolEntry.source = 'manual';

  // ブロック構築
  let blockHash = '';
  try {
    blockHash = await computeBlockHash(initData.fileUri, msg.startLine, msg.endLine);
  } catch (err) {
    log('blockEditPanel: block hash computation failed', { error: String(err) });
  }
  const newBlock: CachedBlock = {
    label: msg.label,
    startLine: msg.startLine,
    endLine: msg.endLine,
    colorIndex: msg.colorIndex,
    description: msg.description,
    explanation: msg.explanation || undefined,
    annotations: msg.annotations.length > 0 ? msg.annotations : undefined,
    blockHash,
  };

  const manualBlockIndex = initData.sourceBlockIndex ?? initData.blockIndex;
  if (!initData.isImport && initData.source === 'manual' && manualBlockIndex >= 0 && manualBlockIndex < symbolEntry.blocks.length) {
    // 既存ブロック更新
    symbolEntry.blocks[manualBlockIndex] = newBlock;
  } else {
    // 新規ブロック追加
    symbolEntry.blocks.push(newBlock);
  }

  // 概要は最初のブロックの description をフォールバック
  if (!symbolEntry.overview && msg.description) {
    symbolEntry.overview = msg.description;
  }

  // JSON 書込
  await cacheService.writeFile('walks-manual', cacheRelPath, fileExport);
  log('handleSave: saved to walks-manual', { symName, blockLabel: msg.label, totalBlocks: symbolEntry.blocks.length, isNewBlock: initData.blockIndex < 0 });

  // ハイライト + CodeLens を即時更新
  try {
    const doc = await vscode.workspace.openTextDocument(initData.fileUri);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });

    const blockInfos: BlockInfo[] = symbolEntry.blocks.map((b, i) => ({
      index: i,
      label: b.label,
      description: b.description,
      startLine: b.startLine,
      endLine: b.endLine,
      colorIndex: b.colorIndex ?? (i % 6),
    }));

    const blockRanges: BlockRange[] = blockInfos.map(b => {
      const sl = Math.max(0, b.startLine - 1);
      const el = Math.min(doc.lineCount - 1, b.endLine - 1);
      return {
        range: new vscode.Range(sl, 0, el, doc.lineAt(el).text.length),
        colorIndex: b.colorIndex,
      };
    });

    highlightBlocks(editor, blockRanges, buildSymbolOwnerKey(symName, 'manual'));
    blockStore.setBlocks(initData.fileUri, symName, blockInfos, 'manual');

    // 解説
    const mergedDetails = blockStore.getBlockDetails(initData.fileUri, symName) ?? [];
    const manualDetails = mergedDetails.filter(detail => detail.source === 'manual');
    for (let i = 0; i < symbolEntry.blocks.length; i++) {
      const b = symbolEntry.blocks[i];
      const globalIndex = manualDetails.find(detail => detail.sourceBlockIndex === i)?.block.index;
      if (b.explanation) {
        if (globalIndex !== undefined) {
          blockStore.setExplanation(initData.fileUri, symName, globalIndex, b.explanation);
        }
      }
    }

    // アノテーション
    const manualAnnotations: LineAnnotation[] = [];
    for (const b of symbolEntry.blocks) {
      if (b.annotations) {
        for (const a of b.annotations) {
          manualAnnotations.push({ line: a.line, text: a.text });
        }
      }
    }
    setAnnotations(editor, manualAnnotations, buildSymbolOwnerKey(symName, 'manual'));
  } catch (err) {
    log('blockEditPanel: failed to update display', { error: String(err) });
  }

  void notifyInfo(l10n.t('CodeWalker: [M] {0} saved.', msg.label));
}

// ─── HTML 構築 ───────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function buildEditHtml(data: BlockEditInitData, webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const sharedCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'shared.css'));
  const editCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'blockEdit.css'));
  const editJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'blockEdit.js'));

  const paletteButtons = PALETTE.map((p, i) => {
    const selected = i === data.colorIndex ? 'selected' : '';
    const colorName = [l10n.t('Blue'), l10n.t('Green'), l10n.t('Purple'), l10n.t('Orange'), l10n.t('Red'), l10n.t('Cyan')][i] ?? p.name;
    return `<button class="color-btn ${selected}" data-index="${i}" style="background:${p.hex}" title="${colorName}"></button>`;
  }).join('\n');

  const initJson = JSON.stringify({
    colorIndex: data.colorIndex,
    annotations: data.annotations,
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${sharedCss}">
<link rel="stylesheet" href="${editCss}">
</head>
<body>
  <h2>${data.isImport ? l10n.t('📥 Auto → Manual Import') : data.blockIndex >= 0 ? l10n.t('📝 Edit Block') : l10n.t('➕ Add Block')}</h2>
  ${data.isImport ? `<div class="import-note">${l10n.t('Save as Manual based on the Auto block. The Auto block will not be modified.')}</div>` : ''}

  <label for="symbolName">${l10n.t('Symbol Name')}</label>
  <input type="text" id="symbolName" value="${escapeHtml(data.symbolName)}" placeholder="${l10n.t('Function / Class name')}">

  <label for="label">${l10n.t('Block Label')}</label>
  <input type="text" id="label" value="${escapeHtml(data.label)}" placeholder="${l10n.t('Initialization')}">
  <div id="labelSuggestions"></div>

  <div class="row">
    <div class="col">
      <label for="startLine">${l10n.t('Start Line')}</label>
      <input type="number" id="startLine" value="${data.startLine}" min="1">
    </div>
    <div class="col">
      <label for="endLine">${l10n.t('End Line')}</label>
      <input type="number" id="endLine" value="${data.endLine}" min="1">
    </div>
  </div>

  <label>${l10n.t('Block Color')}</label>
  <div class="color-palette">
    ${paletteButtons}
  </div>

  <label for="description">${l10n.t('Description')}</label>
  <input type="text" id="description" value="${escapeHtml(data.description)}" placeholder="${l10n.t('Block description')}">

  <label for="explanation">${l10n.t('Explanation (Markdown)')}</label>
  <textarea id="explanation" placeholder="${l10n.t('Explanation text...')}">${escapeHtml(data.explanation)}</textarea>

  <label>${l10n.t('Line Annotations')}</label>
  <div class="annot-list" id="annotList"></div>
  <button id="addAnnotBtn">${l10n.t('+ Add Annotation')}</button>

  <div class="actions">
    <button class="btn btn-primary" id="saveBtn">${l10n.t('💾 Save')}</button>
    <button class="btn btn-secondary" id="previewBtn">${l10n.t('👁 Preview')}</button>
  </div>

  <script nonce="${nonce}" id="init-data" type="application/json">${initJson}</script>
  <script nonce="${nonce}" src="${editJs}"></script>
</body>
</html>`;
}
