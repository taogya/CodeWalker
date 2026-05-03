/**
 * blockStore.ts — ブロック情報データストア
 *
 * シンボル単位のブロック情報（BlockDetail）を管理するデータストア。
 * CodeLensProvider・コマンド・ツールから読み書きされ、
 * 変更時に onDidChange イベントを発火する。
 *
 * A-3 (CodeLensProvider の責務過多) を解消するリファクタリング。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockInfo } from '@analysis/contextBuilder';
import type { CacheSource } from '@cache/cacheTypes';
import { log } from '@utils/logger';

/** 表示モード: グローバルフィルタ */
export type ViewMode = 'both' | 'manual-only' | 'auto-only';

/** ブロック別の詳細データ */
export interface BlockDetail {
  block: BlockInfo;
  explanation?: string;
  source?: CacheSource;
  sourceBlockIndex?: number;
  hashMismatch?: boolean;
}

/** 丸数字変換用 */
const CIRCLE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
export function circleNumber(index: number): string {
  return index < CIRCLE_NUMBERS.length ? CIRCLE_NUMBERS[index] : `(${index + 1})`;
}

/**
 * ブロック情報の管理を一元化するデータストア。
 *
 * uri.toString() → symbolName → BlockDetail[] の三段マップ構造で、
 * 同一ファイル内の複数シンボルを独立管理する。
 */
export class BlockStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** uri.toString() → symbolName → BlockDetail[] */
  private _blocks: Map<string, Map<string, BlockDetail[]>> = new Map();

  /** グローバル表示モード */
  private _viewMode: ViewMode = 'both';

  /** 現在の表示モードを取得 */
  get viewMode(): ViewMode { return this._viewMode; }

  /** 表示モードを変更し、CodeLens を更新する */
  setViewMode(mode: ViewMode): void {
    const prev = this._viewMode;
    this._viewMode = mode;
    log('BlockStore.setViewMode', { from: prev, to: mode });
    this._onDidChange.fire();
  }

  // ── CRUD ─────────────────────────────────────

  /**
   * シンボル単位でブロック情報を設定する。
   * 同じ URI の他シンボルは保持される。
   */
  setBlocks(uri: vscode.Uri, symbolName: string, blocks: BlockInfo[], source?: CacheSource): void {
    const uriKey = uri.toString();
    let symbolMap = this._blocks.get(uriKey);
    const isNew = !symbolMap;
    if (!symbolMap) {
      symbolMap = new Map();
      this._blocks.set(uriKey, symbolMap);
    }
    const prevBlocks = symbolMap.get(symbolName);
    symbolMap.set(symbolName, this.mergeDetailsBySource(prevBlocks, blocks, source));
    log('BlockStore.setBlocks', {
      uri: uriKey,
      symbolName,
      blockCount: blocks.length,
      source,
      isNewUri: isNew,
      prevBlockCount: prevBlocks?.length ?? 0,
      blockLabels: blocks.map(b => `${b.label}(L${b.startLine}-L${b.endLine})`),
    });
    this._onDidChange.fire();
  }

  private mergeDetailsBySource(
    prevBlocks: BlockDetail[] | undefined,
    blocks: BlockInfo[],
    source?: CacheSource,
  ): BlockDetail[] {
    const incomingDetails: BlockDetail[] = blocks.map((block, index) => ({
      block: { ...block },
      source,
      sourceBlockIndex: index,
    }));

    if (!source) {
      return this.normalizeDetails(incomingDetails);
    }

    const retained = (prevBlocks ?? []).filter(detail => detail.source !== source)
      .map(detail => ({
        ...detail,
        block: { ...detail.block },
      }));

    return this.normalizeDetails([...retained, ...incomingDetails]);
  }

  private normalizeDetails(details: BlockDetail[]): BlockDetail[] {
    const sourceOrder = (source: CacheSource | undefined): number => {
      if (source === 'manual') { return 0; }
      if (source === 'auto') { return 1; }
      return 2;
    };

    const sorted = [...details].sort((left, right) => {
      const leftOrder = sourceOrder(left.source);
      const rightOrder = sourceOrder(right.source);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      const leftIndex = left.sourceBlockIndex ?? left.block.index;
      const rightIndex = right.sourceBlockIndex ?? right.block.index;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      if (left.block.startLine !== right.block.startLine) {
        return left.block.startLine - right.block.startLine;
      }
      return left.block.endLine - right.block.endLine;
    });

    const perSourceIndex = new Map<CacheSource | undefined, number>();
    return sorted.map((detail, globalIndex) => {
      const nextSourceIndex = perSourceIndex.get(detail.source) ?? 0;
      perSourceIndex.set(detail.source, nextSourceIndex + 1);
      return {
        ...detail,
        block: {
          ...detail.block,
          index: globalIndex,
        },
        sourceBlockIndex: nextSourceIndex,
      };
    });
  }

  /** 指定 URI のシンボルを削除する */
  removeSymbol(uri: vscode.Uri, symbolName: string): void {
    const symbolMap = this._blocks.get(uri.toString());
    const existed = symbolMap?.has(symbolName) ?? false;
    if (symbolMap) {
      symbolMap.delete(symbolName);
      this._onDidChange.fire();
    }
    log('BlockStore.removeSymbol', { uri: uri.toString(), symbolName, existed, remainingSymbols: symbolMap ? [...symbolMap.keys()] : [] });
  }

  /** 指定シンボル内の特定ブロックを削除する（インデックス振り直し付き） */
  removeBlock(uri: vscode.Uri, symbolName: string, blockIndex: number): void {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    if (!details) {
      log('BlockStore.removeBlock: details not found', { uri: uri.toString(), symbolName, blockIndex });
      return;
    }
    const removedLabel = details[blockIndex]?.block?.label ?? '(unknown)';
    const nextDetails = details.filter((_, index) => index !== blockIndex);
    if (nextDetails.length === 0) {
      symbolMap?.delete(symbolName);
      log('BlockStore.removeBlock: symbol removed because last block was deleted', {
        uri: uri.toString(),
        symbolName,
        removedLabel,
      });
      this._onDidChange.fire();
      return;
    }
    symbolMap?.set(symbolName, this.normalizeDetails(nextDetails));
    log('BlockStore.removeBlock', {
      uri: uri.toString(), symbolName, blockIndex,
      removedLabel,
      remainingBlocks: nextDetails.length,
      reindexed: symbolMap?.get(symbolName)?.map(d => `${d.block.index}:${d.block.label}`) ?? [],
    });
    this._onDidChange.fire();
  }

  removeBlocksBySource(uri: vscode.Uri, symbolName: string, source: CacheSource): void {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    if (!details) {
      return;
    }

    const nextDetails = details.filter(detail => detail.source !== source);
    if (nextDetails.length === 0) {
      symbolMap?.delete(symbolName);
    } else {
      symbolMap?.set(symbolName, this.normalizeDetails(nextDetails));
    }
    this._onDidChange.fire();
  }

  // ── 参照 ─────────────────────────────────────

  /** 指定 URI のシンボル名一覧 */
  getSymbolNames(uri: vscode.Uri): string[] {
    const symbolMap = this._blocks.get(uri.toString());
    return symbolMap ? [...symbolMap.keys()] : [];
  }

  /** 現在保持している URI 一覧 */
  getUris(): vscode.Uri[] {
    return [...this._blocks.keys()].map(key => vscode.Uri.parse(key));
  }

  /** 指定 URI で source が一致するシンボル名一覧 */
  getSymbolNamesBySource(uri: vscode.Uri, source: CacheSource): string[] {
    const symbolMap = this._blocks.get(uri.toString());
    if (!symbolMap) { return []; }
    const names: string[] = [];
    for (const [symbolName, details] of symbolMap) {
      if (details.some(detail => detail.source === source)) {
        names.push(symbolName);
      }
    }
    return names;
  }

  /** 指定 URI × シンボルの BlockDetail リスト */
  getBlockDetails(uri: vscode.Uri, symbolName: string): BlockDetail[] | undefined {
    const symbolMap = this._blocks.get(uri.toString());
    return symbolMap?.get(symbolName);
  }

  /** BlockInfo 単体取得 */
  getBlockInfo(uri: vscode.Uri, symbolName: string, blockIndex: number): BlockInfo | undefined {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    return details?.[blockIndex]?.block;
  }

  getBlockDetail(uri: vscode.Uri, symbolName: string, blockIndex: number): BlockDetail | undefined {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    return details?.[blockIndex];
  }

  /** 指定 URI のシンボルマップ（CodeLensProvider 描画用） */
  getSymbolMap(uri: vscode.Uri): Map<string, BlockDetail[]> | undefined {
    return this._blocks.get(uri.toString());
  }

  /** ブロック概要テキスト取得（CodeLens クリック表示用） */
  getBlockDescription(uri: vscode.Uri, symbolName: string, blockIndex: number): string | undefined {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    const detail = details?.[blockIndex];
    if (!detail) { return undefined; }
    const b = detail.block;
    return `【${circleNumber(b.index)} ${b.label}】(L${b.startLine}-L${b.endLine})\n\n${b.description ?? l10n.t('Drill down for detailed explanation.')}`;
  }

  // ── 解説・フラグ管理 ─────────────────────────

  /** ブロック解説を設定 */
  setExplanation(uri: vscode.Uri, symbolName: string, blockIndex: number, explanation: string): void {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    if (details && details[blockIndex]) {
      details[blockIndex].explanation = explanation;
      log('BlockStore.setExplanation', { uri: uri.toString(), symbolName, blockIndex, explanationLength: explanation.length });
      this._onDidChange.fire();
    } else {
      log('BlockStore.setExplanation: target not found', {
        uri: uri.toString(), symbolName, blockIndex,
        hasSymbolMap: !!symbolMap, hasDetails: !!details,
        detailsLength: details?.length ?? 0,
      });
    }
  }

  /** ブロック解説を取得 */
  getExplanation(uri: vscode.Uri, symbolName: string, blockIndex: number): string | undefined {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    return details?.[blockIndex]?.explanation;
  }

  /** ハッシュ不一致フラグを設定（シンボル内全ブロック一括） */
  setHashMismatch(uri: vscode.Uri, symbolName: string, mismatch: boolean): void {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    if (details) {
      for (const d of details) { d.hashMismatch = mismatch; }
      log('BlockStore.setHashMismatch', { uri: uri.toString(), symbolName, mismatch, affectedBlocks: details.length });
      this._onDidChange.fire();
    }
  }

  /** ハッシュ不一致フラグをブロック単位で設定 */
  setBlockHashMismatch(uri: vscode.Uri, symbolName: string, blockIndex: number, mismatch: boolean): void {
    const symbolMap = this._blocks.get(uri.toString());
    const details = symbolMap?.get(symbolName);
    if (details && details[blockIndex]) {
      details[blockIndex].hashMismatch = mismatch;
      log('BlockStore.setBlockHashMismatch', { uri: uri.toString(), symbolName, blockIndex, mismatch });
      this._onDidChange.fire();
    }
  }

  // ── ライフサイクル ───────────────────────────

  /**
   * テキスト変更に伴う行番号自動調整 (C2)。
   *
   * @param uri        変更されたファイルの URI
   * @param changeStart0  変更範囲の開始行 (0-based)
   * @param changeEnd0    変更範囲の終了行 (0-based)
   * @param delta         行数差分 (正=挿入, 負=削除)
   * @returns 調整が行われた場合 true
   */
  adjustLineNumbers(uri: vscode.Uri, changeStart0: number, changeEnd0: number, delta: number): boolean {
    const symbolMap = this._blocks.get(uri.toString());
    if (!symbolMap || delta === 0) { return false; }

    let adjusted = false;
    for (const [, details] of symbolMap) {
      for (const d of details) {
        const b = d.block;
        // block.startLine / endLine は 1-based
        if (changeEnd0 + 1 < b.startLine) {
          // 変更がブロックより前 → 両方シフト
          b.startLine += delta;
          b.endLine += delta;
          adjusted = true;
        } else if (changeStart0 + 1 <= b.endLine) {
          // 変更がブロック内または重複 → endLine のみ調整
          b.endLine += delta;
          if (b.endLine < b.startLine) { b.endLine = b.startLine; }
          adjusted = true;
        }
        // else: 変更がブロックより後 → 何もしない
      }
    }

    if (adjusted) {
      log('BlockStore.adjustLineNumbers', {
        uri: uri.toString(),
        changeStart0,
        changeEnd0,
        delta,
      });
      this._onDidChange.fire();
    }
    return adjusted;
  }

  /**
   * 保存時のブロック整合性検証 (C2-F)。
   *
   * 壊れたブロック（0行・逆転・重複）を検出し hashMismatch=true を設定する。
   * 既に hashMismatch=true だったブロックが正常に戻った場合はフラグを外さない
   * （ハッシュ検証由来の ⚠ を誤って消さないため）。
   *
   * @param uri  検証対象ファイルの URI
   * @returns 新たに ⚠ を付与したブロック数
   */
  validateBlocks(uri: vscode.Uri): number {
    const symbolMap = this._blocks.get(uri.toString());
    if (!symbolMap) { return 0; }

    let warnCount = 0;

    for (const [symbolName, details] of symbolMap) {
      // 同一 source 内だけを検証対象にし、Manual/Auto の合法な重複を壊れ判定しない
      const detailGroups = new Map<CacheSource | undefined, BlockDetail[]>();
      for (const detail of details) {
        const group = detailGroups.get(detail.source) ?? [];
        group.push(detail);
        detailGroups.set(detail.source, group);
      }

      for (const sorted of detailGroups.values()) {
        sorted.sort((a, b) => a.block.startLine - b.block.startLine);

        for (let i = 0; i < sorted.length; i++) {
          const d = sorted[i];
          const b = d.block;
          let broken = false;

          // #6: 0行ブロック or 逆転（endLine <= startLine は異常）
          // ※ endLine == startLine は1行ブロックとして正常の場合もあるが、
          //    adjustLineNumbers でクランプされた結果の 0行ブロックを検出
          if (b.endLine < b.startLine) {
            broken = true;
          } else if (b.endLine === b.startLine) {
            // startLine == endLine は「全行削除されてクランプされた」可能性がある
            // ファイル概要（symbolName="📄"）は startLine==endLine==1 が正常なので除外
            if (symbolName !== '📄') {
              broken = true;
            }
          }

          // #7: 前のブロックと重複（前ブロックの endLine >= 現ブロックの startLine）
          if (!broken && i > 0) {
            const prev = sorted[i - 1].block;
            if (prev.endLine >= b.startLine) {
              broken = true;
            }
          }

          if (broken && !d.hashMismatch) {
            d.hashMismatch = true;
            warnCount++;
            log('BlockStore.validateBlocks: broken block detected', {
              uri: uri.toString(),
              symbolName,
              blockIndex: b.index,
              label: b.label,
              startLine: b.startLine,
              endLine: b.endLine,
              source: d.source,
              reason: b.endLine <= b.startLine ? 'collapsed' : 'overlap',
            });
          }
        }
      }
    }

    if (warnCount > 0) {
      this._onDidChange.fire();
    }
    return warnCount;
  }

  /** 全データクリア */
  clear(): void {
    const uriCount = this._blocks.size;
    const totalSymbols = [...this._blocks.values()].reduce((sum, m) => sum + m.size, 0);
    this._blocks.clear();
    log('BlockStore.clear', { clearedUris: uriCount, clearedSymbols: totalSymbols });
    this._onDidChange.fire();
  }

  /** 指定 URI のデータをクリアする（ファイルクローズ時用） */
  clearUri(uri: vscode.Uri): void {
    const uriKey = uri.toString();
    const symbolMap = this._blocks.get(uriKey);
    const symbolNames = symbolMap ? [...symbolMap.keys()] : [];
    if (this._blocks.delete(uriKey)) {
      log('BlockStore.clearUri', { uri: uriKey, clearedSymbols: symbolNames });
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    log('BlockStore.dispose', { remainingUris: this._blocks.size });
    this._onDidChange.dispose();
    this._blocks.clear();
  }
}
