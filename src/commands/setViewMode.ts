/**
 * setViewMode.ts — 表示モード切替コマンド
 *
 * コマンドパレットから Both / Manual Only / Auto Only を選択し、
 * BlockStore の viewMode を変更する。
 * ステータスバーの表示も更新する。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import type { BlockStore, ViewMode, BlockDetail } from '@walker/blockStore';
import { buildSymbolOwnerKey, highlightBlocks, type BlockRange } from '@walker/highlighter';
import { lineRange } from '@utils/fileUtils';
import { log } from '@utils/logger';

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  'both': 'Both (Manual + Auto)',
  'manual-only': 'Manual Only',
  'auto-only': 'Auto Only',
};

export async function setViewModeCommand(
  blockStore: BlockStore,
  statusBarItem: vscode.StatusBarItem,
): Promise<void> {
  const current = blockStore.viewMode;

  const items: vscode.QuickPickItem[] = (['both', 'manual-only', 'auto-only'] as ViewMode[]).map(mode => ({
    label: VIEW_MODE_LABELS[mode],
    description: mode === current ? l10n.t('(current)') : '',
    detail: mode,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: l10n.t('CodeWalker: View Mode'),
    placeHolder: l10n.t('Select block source to display'),
  });

  if (!selected) { return; }

  const mode = selected.detail as ViewMode;
  log('setViewModeCommand: changing', { from: current, to: mode });
  blockStore.setViewMode(mode);           // → CodeLens も更新される
  reapplyHighlightsForViewMode(blockStore, mode);
  updateStatusBar(statusBarItem, mode);
  log('setViewModeCommand: completed', { mode });
}

// ── ViewMode に応じたハイライト再描画 ──────────────

/** 可視エディタのハイライトを viewMode でフィルタして再描画する */
function reapplyHighlightsForViewMode(store: BlockStore, mode: ViewMode): void {
  for (const editor of vscode.window.visibleTextEditors) {
    const uri = editor.document.uri;
    const symbolMap = store.getSymbolMap(uri);
    if (!symbolMap) { continue; }

    for (const [symbolName, details] of symbolMap) {
      for (const source of ['manual', 'auto'] as const) {
        const filtered = filterDetailsByMode(details, mode).filter(detail => detail.source === source);
        const ranges: BlockRange[] = filtered.map(d => ({
          range: lineRange(editor.document, d.block.startLine, d.block.endLine),
          colorIndex: d.block.colorIndex,
        }));
        highlightBlocks(editor, ranges, buildSymbolOwnerKey(symbolName, source));
      }
    }
  }
}

/** ViewMode に応じて BlockDetail をフィルタする */
function filterDetailsByMode(details: BlockDetail[], mode: ViewMode): BlockDetail[] {
  if (mode === 'both') { return details; }
  const target = mode === 'manual-only' ? 'manual' : 'auto';
  return details.filter(d => d.source === target);
}

/** ステータスバーの表示を更新する */
export function updateStatusBar(item: vscode.StatusBarItem, mode: ViewMode): void {
  const icons: Record<ViewMode, string> = {
    'both': '$(layers) Both',
    'manual-only': '$(edit) Manual',
    'auto-only': '$(robot) Auto',
  };
  item.text = `CW: ${icons[mode]}`;
  item.tooltip = l10n.t('CodeWalker View Mode: {0}', VIEW_MODE_LABELS[mode]);
  item.show();
}
