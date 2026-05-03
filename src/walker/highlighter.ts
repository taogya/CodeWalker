/**
 * highlighter.ts — テキストエディタのコードハイライト管理
 *
 * ブロック色分け（最大6色パレット）と行末アノテーション表示をサポートする。
 */

import * as vscode from 'vscode';
import { loadConfig } from '@cache/configReader';
import { log } from '@utils/logger';

// ─── カラーパレット ────────────────────────────────────────

/** ブロック色分け用カラーパレット（最大 6 色、循環） */
const BLOCK_PALETTE = [
  { bg: 'rgba(66, 133, 244, 0.10)',  border: 'rgba(66, 133, 244, 0.40)',  ruler: 'rgba(66, 133, 244, 0.6)' },   // 青
  { bg: 'rgba(52, 168, 83, 0.10)',   border: 'rgba(52, 168, 83, 0.40)',   ruler: 'rgba(52, 168, 83, 0.6)' },    // 緑
  { bg: 'rgba(154, 77, 202, 0.10)',  border: 'rgba(154, 77, 202, 0.40)',  ruler: 'rgba(154, 77, 202, 0.6)' },   // 紫
  { bg: 'rgba(234, 134, 0, 0.10)',   border: 'rgba(234, 134, 0, 0.40)',   ruler: 'rgba(234, 134, 0, 0.6)' },    // オレンジ
  { bg: 'rgba(219, 68, 55, 0.10)',   border: 'rgba(219, 68, 55, 0.40)',   ruler: 'rgba(219, 68, 55, 0.6)' },    // 赤
  { bg: 'rgba(0, 172, 193, 0.10)',   border: 'rgba(0, 172, 193, 0.40)',   ruler: 'rgba(0, 172, 193, 0.6)' },    // シアン
];

/** ハイライト対象ブロックの情報 */
export interface BlockRange {
  range: vscode.Range;
  colorIndex: number;
}

/** 行末アノテーション */
export interface LineAnnotation {
  /** 1-based line number */
  line: number;
  text: string;
}

export function buildSymbolOwnerKey(symbolName: string, source?: 'manual' | 'auto'): string {
  return source ? `${symbolName}::${source}` : symbolName;
}

// ─── Decoration 管理 ────────────────────────────────────────

/** ブロック色分け用 — colorIndex → DecorationType */
const blockDecoTypes: Map<number, vscode.TextEditorDecorationType> = new Map();

/** 行末アノテーション用（遅延初期化、dispose するまで再利用） */
let annotationDecoType: vscode.TextEditorDecorationType | undefined;
let currentAnnotationStyle: 'italic' | 'normal' | undefined;

/** 蓄積されたアノテーション（uri.toString() → ownerKey → annotations） */
const storedAnnotations: Map<string, Map<string, LineAnnotation[]>> = new Map();

/** 現在適用中のエディタ参照（クリア用） */
let activeEditor: vscode.TextEditor | undefined;

/** 現在適用中の全 decoration を追跡 */
const activeDecorations: Set<vscode.TextEditorDecorationType> = new Set();

/**
 * 蓄積されたブロック範囲（uri → symbolName → BlockRange[]）。
 * シンボル単位で管理し、同一ファイル内の複数シンボルの色分けを共存させる。
 */
const storedBlocks: Map<string, Map<string, BlockRange[]>> = new Map();

function getVisibleEditorsForUri(uriKey: string): vscode.TextEditor[] {
  return vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === uriKey);
}

function applyBlocksForUri(uriKey: string): void {
  const editors = getVisibleEditorsForUri(uriKey);
  if (editors.length === 0) { return; }

  const uriMap = storedBlocks.get(uriKey);
  const allBlocks: BlockRange[] = [];
  if (uriMap) {
    for (const symbolBlocks of uriMap.values()) {
      allBlocks.push(...symbolBlocks);
    }
  }

  const byColor = new Map<number, vscode.Range[]>();
  for (const block of allBlocks) {
    const idx = block.colorIndex % BLOCK_PALETTE.length;
    let ranges = byColor.get(idx);
    if (!ranges) {
      ranges = [];
      byColor.set(idx, ranges);
    }
    ranges.push(block.range);
  }

  for (const editor of editors) {
    for (const [idx, deco] of blockDecoTypes) {
      const ranges = byColor.get(idx);
      editor.setDecorations(deco, ranges ? ranges.map(range => ({ range })) : []);
    }
  }
}

function mergedAnnotationsForUri(uriKey: string): LineAnnotation[] {
  const ownerMap = storedAnnotations.get(uriKey);
  if (!ownerMap) { return []; }

  const merged = new Map<number, string>();
  for (const annotations of ownerMap.values()) {
    for (const annotation of annotations) {
      merged.set(annotation.line, annotation.text);
    }
  }

  const all: LineAnnotation[] = [];
  for (const [line, text] of merged) {
    all.push({ line, text });
  }
  all.sort((a, b) => a.line - b.line);
  return all;
}

function applyAnnotationsForUri(uriKey: string): void {
  const editors = getVisibleEditorsForUri(uriKey);
  if (editors.length === 0) { return; }

  const all = mergedAnnotationsForUri(uriKey);
  for (const editor of editors) {
    applyAnnotations(editor, all);
  }
}

// ─── DecorationType 生成 ────────────────────────────────────

function getBlockDecoType(colorIndex: number): vscode.TextEditorDecorationType {
  const idx = colorIndex % BLOCK_PALETTE.length;
  let deco = blockDecoTypes.get(idx);
  if (deco) { return deco; }

  const c = BLOCK_PALETTE[idx];
  deco = vscode.window.createTextEditorDecorationType({
    backgroundColor: c.bg,
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: c.border,
    isWholeLine: true,
    overviewRulerColor: c.ruler,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  blockDecoTypes.set(idx, deco);
  return deco;
}

// ─── 公開 API ────────────────────────────────────────────

/**
 * ブロックをシンボル単位で色分けハイライトする。
 * 同一ファイル内の複数シンボルのハイライトは蓄積・共存する。
 * 同じシンボルで再度呼ばれた場合はそのシンボルのブロックのみ置き換える。
 */
export function highlightBlocks(editor: vscode.TextEditor, blocks: BlockRange[], symbolName?: string): void {
  const uriKey = editor.document.uri.toString();
  const symKey = symbolName ?? '_default_';
  activeEditor = editor;

  log('highlighter.highlightBlocks', {
    uri: uriKey, symbolName: symKey,
    blockCount: blocks.length,
    ranges: blocks.map(b => `L${b.range.start.line + 1}-L${b.range.end.line + 1}(c${b.colorIndex})`),
  });

  // シンボル単位でブロックを蓄積（同じシンボルは置き換え）
  let uriMap = storedBlocks.get(uriKey);
  if (!uriMap) {
    uriMap = new Map();
    storedBlocks.set(uriKey, uriMap);
  }
  uriMap.set(symKey, blocks);

  for (const block of blocks) {
    activeDecorations.add(getBlockDecoType(block.colorIndex));
  }

  applyBlocksForUri(uriKey);

  // 全体を画面に表示
  if (blocks.length > 0) {
    editor.revealRange(blocks[0].range, vscode.TextEditorRevealType.InCenter);
  }
}

/**
 * 行末にアノテーション（薄い文字）を追加する。
 * 既存のアノテーションに累積される（同じ行は上書き）。
 */
export function setAnnotations(editor: vscode.TextEditor, annotations: LineAnnotation[], ownerKey = '_default_'): void {
  const uriKey = editor.document.uri.toString();
  log('highlighter.setAnnotations', { uri: uriKey, annotationCount: annotations.length, ownerKey });

  let ownerMap = storedAnnotations.get(uriKey);
  if (!ownerMap) {
    ownerMap = new Map();
    storedAnnotations.set(uriKey, ownerMap);
  }

  if (annotations.length > 0) {
    ownerMap.set(ownerKey, annotations);
  } else {
    ownerMap.delete(ownerKey);
    if (ownerMap.size === 0) {
      storedAnnotations.delete(uriKey);
    }
  }

  applyAnnotationsForUri(uriKey);
}

/**
 * 蓄積された全アノテーションを再描画する（内部用）。
 * annotationDecoType を再利用し、editor ごとに独立した装飾を設定する。
 */
function applyAnnotations(editor: vscode.TextEditor, annotations: LineAnnotation[]): void {
  const style = loadConfig().annotationStyle === 'normal' ? 'normal' : 'italic';

  // 遅延初期化（1つの DecoType を全エディタで共用）
  if (!annotationDecoType || currentAnnotationStyle !== style) {
    annotationDecoType?.dispose();
    annotationDecoType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2em',
        fontStyle: style,
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
      },
    });
    currentAnnotationStyle = style;
    activeDecorations.add(annotationDecoType);
  }

  if (annotations.length === 0) {
    editor.setDecorations(annotationDecoType, []);
    return;
  }

  const decoOptions: vscode.DecorationOptions[] = annotations.map(a => {
    const lineIdx = Math.max(0, a.line - 1);
    const lineLen = editor.document.lineAt(lineIdx).text.length;
    return {
      range: new vscode.Range(lineIdx, lineLen, lineIdx, lineLen),
      renderOptions: {
        after: {
          contentText: `  ← ${a.text}`,
        },
      },
    };
  });

  editor.setDecorations(annotationDecoType, decoOptions);
}

/**
 * エディタの蓄積アノテーションを再適用する（ブロック切替時に呼ぶ）。
 */
export function reapplyAnnotations(editor: vscode.TextEditor): void {
  const uriKey = editor.document.uri.toString();
  applyAnnotationsForUri(uriKey);
}

export function hideAnnotations(editor: vscode.TextEditor): void {
  if (!annotationDecoType) { return; }
  editor.setDecorations(annotationDecoType, []);
}

export function refreshAnnotationDecorations(): void {
  log('highlighter.refreshAnnotationDecorations', {
    storedAnnotationUris: [...storedAnnotations.keys()],
    visibleEditors: vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()),
  });

  annotationDecoType?.dispose();
  annotationDecoType = undefined;
  currentAnnotationStyle = undefined;

  const targetUris = new Set<string>([
    ...storedAnnotations.keys(),
    ...vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()),
  ]);
  for (const uriKey of targetUris) {
    applyAnnotationsForUri(uriKey);
  }
}

export function reapplyDecorations(editor: vscode.TextEditor): void {
  const uriKey = editor.document.uri.toString();
  activeEditor = editor;
  applyBlocksForUri(uriKey);
  applyAnnotationsForUri(uriKey);
}

export function hasStoredDecorations(uri: vscode.Uri): boolean {
  const uriKey = uri.toString();
  return storedBlocks.has(uriKey) || storedAnnotations.has(uriKey);
}

/**
 * すべてのハイライトとアノテーションをクリアする。
 */
export function clearAll(): void {
  log('highlighter.clearAll', {
    blockDecoTypeCount: blockDecoTypes.size,
    storedBlockUris: [...storedBlocks.keys()],
    storedAnnotationUris: [...storedAnnotations.keys()],
  });
  // ブロック decoration を全エディタから除去（dispose で全エディタに反映）
  for (const deco of blockDecoTypes.values()) {
    deco.dispose();
  }
  blockDecoTypes.clear();

  // アノテーション decoration を除去
  if (annotationDecoType) {
    annotationDecoType.dispose();
    annotationDecoType = undefined;
  }
  currentAnnotationStyle = undefined;

  activeDecorations.clear();
  storedBlocks.clear();
  storedAnnotations.clear();
  activeEditor = undefined;
}

/**
 * 指定 URI のハイライト・アノテーションをクリアする。
 * ファイルを閉じた際に呼び出す。
 */
export function clearUri(uriKey: string): void {
  log('highlighter.clearUri', {
    uri: uriKey,
    hadBlocks: storedBlocks.has(uriKey),
    hadAnnotations: storedAnnotations.has(uriKey),
  });
  storedBlocks.delete(uriKey);
  storedAnnotations.delete(uriKey);
  applyBlocksForUri(uriKey);
  applyAnnotationsForUri(uriKey);
}

/**
 * 指定 URI ・シンボルのブロックを削除し、ハイライトを再適用する。
 * プレビュークリア等で使用。
 */
export function clearSymbol(editor: vscode.TextEditor, symbolName: string): void {
  clearSymbolByUri(editor.document.uri, symbolName);
}

export function clearSymbolOwnerByUri(uri: vscode.Uri, ownerKey: string): void {
  const uriKey = uri.toString();
  const uriMap = storedBlocks.get(uriKey);
  if (uriMap) {
    uriMap.delete(ownerKey);
    if (uriMap.size === 0) {
      storedBlocks.delete(uriKey);
    }
  }

  const ownerMap = storedAnnotations.get(uriKey);
  if (ownerMap) {
    ownerMap.delete(ownerKey);
    if (ownerMap.size === 0) {
      storedAnnotations.delete(uriKey);
    }
  }

  applyBlocksForUri(uriKey);
  applyAnnotationsForUri(uriKey);
}

export function clearSymbolByUri(uri: vscode.Uri, symbolName: string): void {
  const uriKey = uri.toString();
  const uriMap = storedBlocks.get(uriKey);
  const targetKeys = new Set<string>([
    symbolName,
    buildSymbolOwnerKey(symbolName, 'manual'),
    buildSymbolOwnerKey(symbolName, 'auto'),
  ]);
  const hadAnyBlock = uriMap ? [...targetKeys].some(key => uriMap.has(key)) : false;
  if (!uriMap || !hadAnyBlock) {
    log('highlighter.clearSymbol: block not found', { uri: uriKey, symbolName });
  } else {
    log('highlighter.clearSymbol', {
      uri: uriKey, symbolName,
      remainingSymbols: [...uriMap.keys()].filter(k => !targetKeys.has(k)),
    });
    for (const key of targetKeys) {
      uriMap.delete(key);
    }
    if (uriMap.size === 0) {
      storedBlocks.delete(uriKey);
    }
  }

  const ownerMap = storedAnnotations.get(uriKey);
  if (ownerMap) {
    for (const key of targetKeys) {
      ownerMap.delete(key);
    }
    if (ownerMap.size === 0) {
      storedAnnotations.delete(uriKey);
    }
  }

  applyBlocksForUri(uriKey);
  applyAnnotationsForUri(uriKey);
}

/**
 * すべての DecorationType を破棄する（拡張 deactivate 時用）。
 */
export function disposeDecorations(): void {
  clearAll();
}

/**
 * テキスト変更に伴う storedAnnotations・storedBlocks の行番号調整 (C2)。
 *
 * @param uriKey         URI 文字列
 * @param changeStart0   変更範囲の開始行 (0-based)
 * @param changeEnd0     変更範囲の終了行 (0-based)
 * @param delta          行数差分 (正=挿入, 負=削除)
 */
export function adjustStoredLines(uriKey: string, changeStart0: number, changeEnd0: number, delta: number): void {
  // --- アノテーション (1-based line) ---
  const ownerMap = storedAnnotations.get(uriKey);
  if (ownerMap) {
    for (const annotations of ownerMap.values()) {
      for (const a of annotations) {
        if (changeEnd0 + 1 < a.line) {
          a.line += delta;
        } else if (changeStart0 + 1 <= a.line) {
          a.line += delta;
          if (a.line < 1) { a.line = 1; }
        }
      }
    }
  }

  // --- storedBlocks (0-based Range) ---
  const uriBlocks = storedBlocks.get(uriKey);
  if (uriBlocks) {
    for (const [sym, blocks] of uriBlocks) {
      const adjusted: BlockRange[] = [];
      for (const b of blocks) {
        const startLine = b.range.start.line;
        const endLine = b.range.end.line;
        let newStart = startLine;
        let newEnd = endLine;

        if (changeEnd0 < startLine) {
          newStart += delta;
          newEnd += delta;
        } else if (changeStart0 <= endLine) {
          newEnd += delta;
          if (newEnd < newStart) { newEnd = newStart; }
        }

        adjusted.push({
          range: new vscode.Range(
            new vscode.Position(newStart, 0),
            new vscode.Position(newEnd, b.range.end.character),
          ),
          colorIndex: b.colorIndex,
        });
      }
      uriBlocks.set(sym, adjusted);
    }
  }
}

export function __getStoredSymbolNames(uri: vscode.Uri): string[] {
  return [...(storedBlocks.get(uri.toString())?.keys() ?? [])];
}

export function __getStoredAnnotationOwners(uri: vscode.Uri): string[] {
  return [...(storedAnnotations.get(uri.toString())?.keys() ?? [])];
}

export function __getCurrentAnnotationStyle(): 'italic' | 'normal' | undefined {
  return currentAnnotationStyle;
}
