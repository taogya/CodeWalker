/**
 * cacheTypes.ts — キャッシュ JSON の共通型定義
 *
 * walks-auto / walks-manual 双方で使用する型。
 * exportTool, restoreCache, analyzeTool が共有する。
 */

/** ブロック内アノテーション */
export interface CachedAnnotation {
  line: number;
  text: string;
}

/** キャッシュ JSON の blocks エントリ */
export interface CachedBlock {
  label: string;
  startLine: number;
  endLine: number;
  colorIndex?: number;
  description?: string;
  explanation?: string;
  annotations?: CachedAnnotation[];
  /** ブロック対象行の SHA-256 ハッシュ (sha256:<hex>) */
  blockHash?: string;
}

/** シンボル 1 つ分のキャッシュ */
export interface CachedSymbolEntry {
  symbolName: string;
  overview: string;
  updatedAt: string;
  source: CacheSource;
  blocks: CachedBlock[];
}

/** ファイル単位キャッシュ JSON */
export interface CachedFileExport {
  version: string;
  filePath: string;
  symbols: Record<string, CachedSymbolEntry>;
}

/** キャッシュソース */
export type CacheSource = 'manual' | 'auto';

/** restoreCache / analyzeTool が返すシンボル復元結果 */
export interface ResolvedSymbol {
  entry: CachedSymbolEntry;
  source: CacheSource;
}
