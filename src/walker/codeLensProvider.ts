/**
 * codeLensProvider.ts — ブロックラベル CodeLens
 *
 * BlockStore のデータに基づいて、各ブロック先頭行に
 * 概要付きラベルを CodeLens として常時表示する。
 * データ管理は BlockStore に委譲し、本クラスは表示のみ担う。
 *
 * A-3 リファクタリング: データストアを blockStore.ts に分離。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { circleNumber, type BlockStore } from './blockStore';
import { log } from '@utils/logger';

export class WalkerCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private _storeSubscription: vscode.Disposable;

  constructor(private readonly _store: BlockStore) {
    // BlockStore の変更を CodeLens 更新イベントに中継
    this._storeSubscription = _store.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const symbolMap = this._store.getSymbolMap(document.uri);
    if (!symbolMap || symbolMap.size === 0) {
      return [];
    }

    log('CodeLensProvider.provideCodeLenses: start', {
      uri: document.uri.toString(),
      symbolCount: symbolMap.size,
      viewMode: this._store.viewMode,
      symbols: [...symbolMap.entries()].map(([name, details]) => ({
        name, blockCount: details.length,
        sources: details.map(d => d.source ?? 'undefined'),
      })),
    });

    const lenses: vscode.CodeLens[] = [];
    const viewMode = this._store.viewMode;

    // [DIAG:B5] 重複ブロック検出用: range 文字列キー → カウント
    const rangeCountMap = new Map<string, number>();

    for (const [symbolName, details] of symbolMap) {
      for (const detail of details) {
        // [DIAG:B6] source が undefined のブロックを検出
        if (detail.source === undefined) {
          log('[DIAG:B6] Block has undefined source — may leak through ViewMode filter', {
            symbolName,
            blockLabel: detail.block.label,
            blockIndex: detail.block.index,
            viewMode,
            uri: document.uri.toString(),
          });
        }

        // viewMode フィルタリング
        if (viewMode === 'manual-only' && detail.source !== 'manual') { continue; }
        if (viewMode === 'auto-only' && detail.source !== 'auto') { continue; }

        const b = detail.block;
        // ブロック先頭行（0-based）
        const lineIndex = Math.max(0, b.startLine - 1);
        const range = new vscode.Range(lineIndex, 0, lineIndex, 0);

        // [DIAG:B5] 同一レンジに複数の CodeLens が登録されるか追跡
        const rangeKey = `${symbolName}:L${b.startLine}-L${b.endLine}`;
        const prevCount = rangeCountMap.get(rangeKey) ?? 0;
        rangeCountMap.set(rangeKey, prevCount + 1);
        if (prevCount > 0) {
          log('[DIAG:B5] Duplicate block range detected in CodeLens', {
            rangeKey,
            count: prevCount + 1,
            symbolName,
            blockIndex: b.index,
            source: detail.source,
            viewMode,
            uri: document.uri.toString(),
          });
        }

        // 概要付きタイトル（常時表示）— source バッジ + ⚠ 付き
        const num = circleNumber(b.index);
        const desc = b.description ? ` — ${b.description}` : '';
        const badge = detail.source === 'manual' ? '[M] ' : detail.source === 'auto' ? '[A] ' : '';
        const warn = detail.hashMismatch ? '⚠ ' : '';
        const title = `${warn}${badge}${num} ${b.label}${desc}`;

        lenses.push(new vscode.CodeLens(range, {
          title,
          command: 'codeWalker.showBlockDetail',
          arguments: [document.uri, symbolName, b.index],
          tooltip: l10n.t('{0} (L{1}-L{2}) — Click to show details', b.label, String(b.startLine), String(b.endLine)),
        }));

        if (detail.hashMismatch) {
          lenses.push(new vscode.CodeLens(range, {
            title: '🛠',
            command: 'codeWalker.repairWalkthrough',
            arguments: [document.uri, symbolName, b.index],
            tooltip: l10n.t('Repair stale walkthrough'),
          }));
        }

        // Manual ブロックには 📝 編集 / ✕ 削除ボタンを追加
        if (detail.source === 'manual') {
          lenses.push(new vscode.CodeLens(range, {
            title: '📝',
            command: 'codeWalker.editBlock',
            arguments: [document.uri, symbolName, b.index],
            tooltip: l10n.t('Edit block'),
          }));
          lenses.push(new vscode.CodeLens(range, {
            title: '✕',
            command: 'codeWalker.deleteBlock',
            arguments: [document.uri, symbolName, b.index],
            tooltip: l10n.t('Delete block'),
          }));
        }

        // Auto ブロックには 📥 インポートボタンを表示
        if (detail.source === 'auto') {
          lenses.push(new vscode.CodeLens(range, {
            title: '📥',
            command: 'codeWalker.editBlock',
            arguments: [document.uri, symbolName, b.index, true /* isImport */],
            tooltip: l10n.t('Import Auto → Manual'),
          }));
        }
      }
    }

    log('CodeLensProvider.provideCodeLenses: completed', {
      uri: document.uri.toString(),
      totalLenses: lenses.length,
      viewMode,
    });

    return lenses;
  }

  dispose(): void {
    this._storeSubscription.dispose();
    this._onDidChangeCodeLenses.dispose();
  }
}
