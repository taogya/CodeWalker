/**
 * clearHighlights.ts — ハイライトクリアコマンド
 */

import { clearAll as clearAllDecorations } from '@walker/highlighter';
import { disposeBlockDetailPanel } from '@walker/blockDetailPanel';
import type { BlockStore } from '@walker/blockStore';
import { log } from '@utils/logger';

export function clearHighlightsCommand(
  blockStore: BlockStore,
  restoredUris: Set<string>,
): void {
  const uriCount = restoredUris.size;
  log('clearHighlightsCommand: start', { restoredUriCount: uriCount, uris: [...restoredUris] });
  clearAllDecorations();
  blockStore.clear();
  disposeBlockDetailPanel();
  restoredUris.clear();
  log('clearHighlightsCommand: completed');
}
