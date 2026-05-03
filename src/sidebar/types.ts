import type { CacheSource } from '@cache/cacheTypes';

export type SidebarTargetStatus = 'pending' | 'done' | 'skip';

export interface WalkthroughBlockNode {
  kind: 'walkthrough-block';
  id: string;
  filePath: string;
  symbolName: string;
  blockIndex: number;
  sourceBlockIndex: number;
  label: string;
  startLine: number;
  endLine: number;
  description?: string;
  source: CacheSource;
  stale: boolean;
}

export interface WalkthroughSymbolNode {
  kind: 'walkthrough-symbol';
  id: string;
  filePath: string;
  symbolName: string;
  source: CacheSource;
  hasManual: boolean;
  hasAuto: boolean;
  staleBlockCount: number;
  children: WalkthroughBlockNode[];
}

export interface WalkthroughFileNode {
  kind: 'walkthrough-file';
  id: string;
  filePath: string;
  staleSymbolCount: number;
  manualSymbolCount: number;
  autoSymbolCount: number;
  mixedSymbolCount: number;
  children: WalkthroughSymbolNode[];
}

export interface UncoveredFileNode {
  kind: 'uncovered-file';
  id: string;
  filePath: string;
}

export interface TargetEntryNode {
  kind: 'target-entry';
  id: string;
  filePath: string;
  symbolName: string;
  targetKind: string;
  line: number;
  endLine?: number;
  level?: string;
  status: SidebarTargetStatus;
}

export interface TargetStatusNode {
  kind: 'target-status';
  id: string;
  status: SidebarTargetStatus;
  children: TargetEntryNode[];
}

export interface SidebarSnapshot {
  walkthroughFiles: WalkthroughFileNode[];
  uncoveredFiles: UncoveredFileNode[];
  staleFiles: WalkthroughFileNode[];
  targetGroups: TargetStatusNode[];
}

export type WalkthroughNode = WalkthroughFileNode | WalkthroughSymbolNode | WalkthroughBlockNode;
export type SidebarNode = WalkthroughNode | UncoveredFileNode | TargetStatusNode | TargetEntryNode;

export interface TargetsFileEntry {
  filePath: string;
  symbolName: string;
  kind: string;
  line: number;
  endLine?: number;
  level?: string;
  status: SidebarTargetStatus;
}

export interface TargetsFile {
  version: string;
  createdAt: string;
  config: {
    path: string;
    level: string;
    extensions: string[];
  };
  targets: TargetsFileEntry[];
  skipped: Array<{ filePath: string; reason: string }>;
  summary: Record<string, unknown>;
}