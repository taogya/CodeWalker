/**
 * blockDetailPanel.ts — ブロック詳細 Webview パネル
 *
 * CodeLens クリック時にブロックの概要・ソースコード・解説を
 * Webview パネルでレンダリング表示する。
 * パネルは再利用され、クリックのたびに内容が更新される。
 *
 * L2 リファクタリング: CSS を media/ に外部化。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockInfo } from '@analysis/contextBuilder';
import { log } from '@utils/logger';

/** パネルに表示するデータ */
export interface BlockDetailData {
  block: BlockInfo;
  sourceCode: string;
  explanation?: string;
  fileName: string;
  /** ナビゲーション用コンテキスト（省略時はナビ非表示） */
  nav?: {
    uriString: string;
    symbolName: string;
    siblings: { index: number; label: string }[];
  };
}

let currentPanel: vscode.WebviewPanel | undefined;
let cachedExtensionUri: vscode.Uri | undefined;
let messageDisposable: vscode.Disposable | undefined;

/** ナビゲーションイベントのコールバック */
export type NavCallback = (uriString: string, symbolName: string, blockIndex: number) => void;
let onNavigate: NavCallback | undefined;

/**
 * extensionUri をセットする（activate 時に 1 回呼ぶ）。
 */
export function setDetailPanelExtensionUri(uri: vscode.Uri): void {
  cachedExtensionUri = uri;
}

/**
 * ナビゲーションコールバックを設定する（activate 時に 1 回呼ぶ）。
 */
export function setDetailPanelNavCallback(cb: NavCallback): void {
  onNavigate = cb;
}

/**
 * ブロック詳細パネルを表示（既存パネルがあれば再利用）。
 */
export function showBlockDetailPanel(data: BlockDetailData): void {
  log('showBlockDetailPanel', {
    blockLabel: data.block.label,
    blockIndex: data.block.index,
    startLine: data.block.startLine,
    endLine: data.block.endLine,
    colorIndex: data.block.colorIndex,
    hasExplanation: !!data.explanation,
    fileName: data.fileName,
    hasNav: !!data.nav,
    siblingCount: data.nav?.siblings.length ?? 0,
    reusingPanel: !!currentPanel,
  });
  const column = vscode.ViewColumn.Beside;
  const extUri = cachedExtensionUri;

  if (currentPanel) {
    // 既存パネルの内容を更新
    currentPanel.webview.html = buildHtml(data, currentPanel.webview, extUri);
    currentPanel.reveal(column, true);
    return;
  }

  const panelOptions: vscode.WebviewOptions = extUri
    ? { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extUri, 'media')] }
    : { enableScripts: true };

  // 新規パネル作成
  currentPanel = vscode.window.createWebviewPanel(
    'codeWalkerBlockDetail',
    `CodeWalker: ${data.block.label}`,
    { viewColumn: column, preserveFocus: true },
    panelOptions,
  );

  currentPanel.webview.html = buildHtml(data, currentPanel.webview, extUri);

  setupDetailMessageHandler(currentPanel);

  currentPanel.onDidDispose(() => {
    log('blockDetailPanel: disposed');
    messageDisposable?.dispose();
    messageDisposable = undefined;
    currentPanel = undefined;
  });
}

/**
 * パネルを閉じる。
 */
export function disposeBlockDetailPanel(): void {
  messageDisposable?.dispose();
  messageDisposable = undefined;
  currentPanel?.dispose();
  currentPanel = undefined;
}

// ── メッセージハンドラ ─────────────────────────────────

interface NavMessage {
  type: 'navigateBlock';
  uriString: string;
  symbolName: string;
  blockIndex: number;
}

interface OpenFileMessage {
  type: 'openFile';
  filePath: string;
}

type DetailMessage = NavMessage | OpenFileMessage;

function setupDetailMessageHandler(panel: vscode.WebviewPanel): void {
  messageDisposable?.dispose();
  messageDisposable = panel.webview.onDidReceiveMessage((msg: DetailMessage) => {
    log('blockDetailPanel: message received', { type: msg.type });
    if (msg.type === 'navigateBlock' && onNavigate) {
      log('blockDetailPanel: navigating', { uriString: msg.uriString, symbolName: msg.symbolName, blockIndex: msg.blockIndex });
      onNavigate(msg.uriString, msg.symbolName, msg.blockIndex);
    } else if (msg.type === 'openFile') {
      log('blockDetailPanel: openFile', { filePath: msg.filePath });
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const fileUri = vscode.Uri.joinPath(wsFolder.uri, msg.filePath);
        vscode.window.showTextDocument(fileUri, { preview: false });
      }
    }
  });
}

// ─── HTML 構築 ────────────────────────────────────────

const PALETTE_COLORS = [
  '#4285F4', // 青
  '#34A853', // 緑
  '#9A4DCA', // 紫
  '#EA8600', // オレンジ
  '#DB4437', // 赤
  '#00ACC1', // シアン
];

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

/**
 * 簡易 Markdown → HTML 変換。
 * LLM が生成する解説テキスト向けに基本的な書式をサポート。
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const result: string[] = [];
  let inList = false;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let inBlockquote = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // コードフェンス (``` or ```)
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // コードフェンス終了
        result.push(`<pre class="fenced-code">${codeBlockLines.map(l => escapeHtml(l)).join('\n')}</pre>`);
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        // コードフェンス開始
        if (inList) { result.push('</ul>'); inList = false; }
        if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 空行
    if (trimmed === '') {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
      result.push('<br>');
      continue;
    }

    // 水平線
    if (/^[-*_]{3,}$/.test(trimmed)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
      result.push('<hr>');
      continue;
    }

    // ブロック引用 (>)
    const quoteMatch = trimmed.match(/^>\s*(.*)/);
    if (quoteMatch) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (!inBlockquote) { result.push('<blockquote>'); inBlockquote = true; }
      result.push(`<p>${inlineFormat(quoteMatch[1])}</p>`);
      continue;
    }

    // 見出し (### / ## / #)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
      const level = headingMatch[1].length + 2; // #→h3, ##→h4, ###→h5
      result.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // リスト項目 (- / * / 数字.)
    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    const numListMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (listMatch || numListMatch) {
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
      if (!inList) { result.push('<ul>'); inList = true; }
      const content = listMatch ? listMatch[1] : numListMatch![1];
      result.push(`<li>${inlineFormat(content)}</li>`);
      continue;
    }

    // 通常テキスト
    if (inList) { result.push('</ul>'); inList = false; }
    if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
    result.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    result.push(`<pre class="fenced-code">${codeBlockLines.map(l => escapeHtml(l)).join('\n')}</pre>`);
  }
  if (inList) { result.push('</ul>'); }
  if (inBlockquote) { result.push('</blockquote>'); }
  return result.join('\n');
}

/** ファイルパスっぽい文字列の判定 (src/foo/bar.ts 形式) */
const FILE_PATH_RE = /^[\w.@-]+(?:\/[\w.@-]+)+\.\w{1,10}$/;

/** インライン書式変換: ![img](url), **bold**, `code`, *italic*, [link](url), 生URL, ファイルパス */
function inlineFormat(text: string): string {
  let html = escapeHtml(text);
  // ![alt](url) → <img>
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  // [link text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // **bold** or __bold__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // `code` → <code> (バッククォート変換)
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  // <code> 内のファイルパスをリンク化: <code>src/foo/bar.ts</code> → <code><a data-file="...">...</a></code>
  html = html.replace(/<code>([^<]+)<\/code>/g, (_match, inner: string) => {
    if (FILE_PATH_RE.test(inner)) {
      return `<code><a data-file="${inner}">${inner}</a></code>`;
    }
    return `<code>${inner}</code>`;
  });
  // *italic* or _italic_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  // 生 URL（既に <a> や <img> 内にあるものは除外）
  html = html.replace(/(?<!href="|src="|">)(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return html;
}

// ─── シンタックスハイライト ─────────────────────────────

type LangId = 'python' | 'typescript' | 'javascript' | 'java' | 'go' | 'rust' | 'csharp' | 'unknown';

/** ファイル拡張子 → 言語 ID */
function detectLanguage(fileName: string): LangId {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, LangId> = {
    py: 'python',
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    java: 'java',
    go: 'go',
    rs: 'rust',
    cs: 'csharp',
  };
  return map[ext] ?? 'unknown';
}

/** 言語別キーワード */
const KEYWORDS: Record<LangId, string[]> = {
  python: [
    'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while',
    'try', 'except', 'finally', 'with', 'as', 'raise', 'pass', 'break', 'continue',
    'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'lambda', 'yield',
    'async', 'await', 'self', 'global', 'nonlocal', 'del', 'assert',
  ],
  typescript: [
    'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
    'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
    'new', 'this', 'super', 'extends', 'implements', 'async', 'await',
    'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
    'readonly', 'private', 'public', 'protected', 'static', 'abstract',
    'as', 'in', 'of', 'default', 'yield', 'delete',
  ],
  javascript: [], // filled below
  java: [
    'public', 'private', 'protected', 'static', 'final', 'abstract', 'class',
    'interface', 'extends', 'implements', 'import', 'package', 'return', 'if',
    'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'try', 'catch', 'finally', 'throw', 'throws', 'new', 'this', 'super',
    'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte',
    'short', 'null', 'true', 'false', 'instanceof', 'synchronized', 'volatile',
  ],
  go: [
    'func', 'package', 'import', 'return', 'if', 'else', 'for', 'range',
    'switch', 'case', 'default', 'break', 'continue', 'go', 'defer',
    'chan', 'map', 'struct', 'interface', 'type', 'var', 'const',
    'true', 'false', 'nil', 'select', 'fallthrough',
  ],
  rust: [
    'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
    'pub', 'use', 'mod', 'crate', 'self', 'super', 'return', 'if', 'else',
    'for', 'while', 'loop', 'match', 'break', 'continue', 'async', 'await',
    'move', 'ref', 'where', 'type', 'true', 'false', 'as', 'in', 'unsafe',
  ],
  csharp: [
    'public', 'private', 'protected', 'internal', 'static', 'readonly', 'const',
    'class', 'interface', 'struct', 'enum', 'namespace', 'using', 'return',
    'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'break',
    'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'base',
    'void', 'int', 'long', 'double', 'float', 'bool', 'string', 'char',
    'null', 'true', 'false', 'var', 'async', 'await', 'override', 'virtual',
    'abstract', 'sealed', 'partial', 'get', 'set', 'value',
  ],
  unknown: [],
};
// JavaScript shares TypeScript keywords (minus type-specific ones)
KEYWORDS.javascript = KEYWORDS.typescript;

/** コメント開始パターン */
const LINE_COMMENT: Record<LangId, string> = {
  python: '#',
  typescript: '//',
  javascript: '//',
  java: '//',
  go: '//',
  rust: '//',
  csharp: '//',
  unknown: '//',
};

/**
 * 1行のソースコードに対して簡易シンタックスハイライトを適用する。
 * 先に文字列・コメント・数値をマーク → 残りのトークンからキーワードを検出。
 */
function highlightSyntax(line: string, lang: LangId): string {
  if (lang === 'unknown') {
    return escapeHtml(line);
  }

  // フェーズ1: 特殊領域（文字列・コメント）を抽出してプレースホルダに置換
  const placeholders: { token: string; html: string }[] = [];
  let processed = line;

  const commentPrefix = LINE_COMMENT[lang];

  // 文字列リテラル（"..." / '...' / `...`（JS/TS のみ）, """...""" / '''...'''（Python））
  // 行内の完結した文字列のみマッチ（複数行文字列はスキップ）
  const stringPatterns = lang === 'python'
    ? [/"""[^]*?"""/g, /'''[^]*?'''/g, /"(?:[^"\\]|\\.)*"/g, /'(?:[^'\\]|\\.)*'/g, /f"(?:[^"\\]|\\.)*"/g, /f'(?:[^'\\]|\\.)*'/g]
    : lang === 'typescript' || lang === 'javascript'
      ? [/`(?:[^`\\]|\\.)*`/g, /"(?:[^"\\]|\\.)*"/g, /'(?:[^'\\]|\\.)*'/g]
      : [/"(?:[^"\\]|\\.)*"/g, /'(?:[^'\\]|\\.)*'/g];

  for (const pat of stringPatterns) {
    processed = processed.replace(pat, (match) => {
      const id = `__PH${placeholders.length}__`;
      placeholders.push({ token: id, html: `<span class="syn-string">${escapeHtml(match)}</span>` });
      return id;
    });
  }

  // 行コメント
  const commentIdx = processed.indexOf(commentPrefix);
  if (commentIdx >= 0) {
    // プレースホルダ内でのマッチを避ける
    const before = processed.slice(0, commentIdx);
    if (!before.includes('__PH')) {
      const commentText = processed.slice(commentIdx);
      const id = `__PH${placeholders.length}__`;
      placeholders.push({ token: id, html: `<span class="syn-comment">${escapeHtml(commentText)}</span>` });
      processed = before + id;
    }
  }

  // フェーズ2: 数値リテラル
  processed = processed.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, (match) => {
    if (match.startsWith('__PH')) { return match; } // プレースホルダスキップ
    const id = `__PH${placeholders.length}__`;
    placeholders.push({ token: id, html: `<span class="syn-number">${escapeHtml(match)}</span>` });
    return id;
  });

  // フェーズ3: キーワード
  const keywords = KEYWORDS[lang];
  if (keywords.length > 0) {
    const kwPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    processed = processed.replace(kwPattern, (match) => {
      if (match.startsWith('__PH')) { return match; }
      const id = `__PH${placeholders.length}__`;
      placeholders.push({ token: id, html: `<span class="syn-keyword">${escapeHtml(match)}</span>` });
      return id;
    });
  }

  // フェーズ4: デコレータ（Python の @ / Java のアノテーション）
  if (lang === 'python' || lang === 'java') {
    processed = processed.replace(/@\w+/g, (match) => {
      const id = `__PH${placeholders.length}__`;
      placeholders.push({ token: id, html: `<span class="syn-decorator">${escapeHtml(match)}</span>` });
      return id;
    });
  }

  // 残りのテキストを HTML エスケープ
  // プレースホルダ以外の部分をエスケープ
  let result = '';
  let lastIdx = 0;
  const phPattern = /__PH\d+__/g;
  let phMatch;
  while ((phMatch = phPattern.exec(processed)) !== null) {
    // プレースホルダ前のテキストをエスケープ
    if (phMatch.index > lastIdx) {
      result += escapeHtml(processed.slice(lastIdx, phMatch.index));
    }
    // プレースホルダを対応する HTML に置換
    const ph = placeholders.find(p => p.token === phMatch![0]);
    result += ph ? ph.html : phMatch[0];
    lastIdx = phMatch.index + phMatch[0].length;
  }
  // 残り
  if (lastIdx < processed.length) {
    result += escapeHtml(processed.slice(lastIdx));
  }

  return result;
}

function buildHtml(data: BlockDetailData, webview: vscode.Webview, extUri?: vscode.Uri): string {
  const { block, sourceCode, explanation, fileName, nav } = data;
  const color = PALETTE_COLORS[block.colorIndex % PALETTE_COLORS.length];
  const nonce = getNonce();
  const circleNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const num = block.index < circleNums.length ? circleNums[block.index] : `(${block.index + 1})`;

  const lang = detectLanguage(fileName);

  const explanationSection = explanation
    ? `<div class="section">
        <h3>${l10n.t('📝 Explanation')}</h3>
        <div class="explanation">${markdownToHtml(explanation)}</div>
      </div>`
    : `<div class="section hint">
        <p>${l10n.t('💡 No explanation data available.')}</p>
      </div>`;

  // ソースコードに行番号 + シンタックスハイライトを付与
  const codeLines = sourceCode.split('\n');
  const numberedCode = codeLines
    .map((line, i) => {
      const lineNum = block.startLine + i;
      const highlighted = highlightSyntax(line, lang);
      return `<span class="line-num">${String(lineNum).padStart(4)}</span> ${highlighted}`;
    })
    .join('\n');

  // CSS リンク: extUri が利用可能なら外部ファイル、なければフォールバック(空)
  let cssLinks = '';
  let jsScript = '';
  if (extUri) {
    const sharedCss = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'shared.css'));
    const detailCss = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'blockDetail.css'));
    const syntaxCss = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'syntax.css'));
    const detailJs  = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'blockDetail.js'));
    cssLinks = `<link rel="stylesheet" href="${sharedCss}">
<link rel="stylesheet" href="${detailCss}">
<link rel="stylesheet" href="${syntaxCss}">`;
  jsScript = `<script nonce="${nonce}" src="${detailJs}"></script>`;
  }

  // ナビゲーションバー
  let navBar = '';
  if (nav && nav.siblings.length > 1) {
    const prevIdx = block.index > 0 ? block.index - 1 : -1;
    const nextIdx = block.index < nav.siblings.length - 1 ? block.index + 1 : -1;
    const prevDisabled = prevIdx < 0 ? 'disabled' : '';
    const nextDisabled = nextIdx < 0 ? 'disabled' : '';

    // ブロック一覧ドロップダウン
    const options = nav.siblings.map(s => {
      const c = s.index < circleNums.length ? circleNums[s.index] : `(${s.index + 1})`;
      const sel = s.index === block.index ? 'selected' : '';
      return `<option value="${s.index}" ${sel}>${c} ${escapeHtml(s.label)}</option>`;
    }).join('');

    navBar = `<div class="nav-bar"
      data-uri="${escapeHtml(nav.uriString)}"
      data-symbol="${escapeHtml(nav.symbolName)}">
      <button class="nav-btn" data-dir="prev" ${prevDisabled}>${l10n.t('◀ Prev')}</button>
      <select class="nav-select">${options}</select>
      <button class="nav-btn" data-dir="next" ${nextDisabled}>${l10n.t('Next ▶')}</button>
      <span class="nav-count">${block.index + 1} / ${nav.siblings.length}</span>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
${cssLinks}
<style>
  :root { --block-color: ${color}; }
</style>
</head>
<body>
  ${navBar}

  <div class="header">
    <h2>${num} ${escapeHtml(block.label)}</h2>
    <div class="meta">${escapeHtml(fileName)} — L${block.startLine}-L${block.endLine}</div>
    ${block.description ? `<div class="description">${escapeHtml(block.description)}</div>` : ''}
  </div>

  <details class="section">
    <summary><h3>${l10n.t('📄 Source Code')}</h3></summary>
    <div class="code-block">${numberedCode}</div>
  </details>

  ${explanationSection}

  ${jsScript}
</body>
</html>`;
}
