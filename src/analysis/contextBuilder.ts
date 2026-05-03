/**
 * contextBuilder.ts — LLM プロンプト用コンテキスト構築
 *
 * コード解析結果と ReverseEngineer のコンテキストを統合して
 * ツール結果として返却する構造体を組み立てる。
 */

import type { ReverseEngineerContext } from './reverseReader';
import type { CacheSource } from '@cache/cacheTypes';

/** ブロック情報（analyze 結果に含める） */
export interface BlockInfo {
  index: number;
  label: string;
  description?: string;
  startLine: number;
  endLine: number;
  colorIndex: number;
}

/** キャッシュされたウォークスルー結果（エクスポート JSON から読み込み） */
export interface CachedWalkthrough {
  createdAt: string;
  overview: string;
  blocks: {
    label: string;
    startLine: number;
    endLine: number;
    description?: string;
    explanation?: string;
    annotations?: { line: number; text: string }[];
  }[];
  /** キャッシュソース (manual / auto) */
  source?: CacheSource;
}

/** code_walker_analyze の返却データ */
export interface AnalyzeResult {
  symbolName: string;
  filePath: string;
  range: { startLine: number; endLine: number };
  sourceCode: string;
  depth: number;
  systemContext: ReverseEngineerContext | null;
  childSymbols?: {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
  }[];
  /** 前回のウォークスルー結果があれば含まれる */
  cachedWalkthrough?: CachedWalkthrough;
}

/**
 * 解析結果をツール返却用 JSON 文字列に変換する。
 */
export function buildAnalyzeResult(result: AnalyzeResult): string {
  return JSON.stringify(result, null, 2);
}

/** code_walker_drilldown の返却データ */
export interface DrilldownResult {
  /** true = ユーザーが ESC で終了 */
  finished: boolean;
  /** ユーザーが自由入力した質問・指示テキスト */
  question?: string;
}

/**
 * ドリルダウン結果をツール返却用 JSON 文字列に変換する。
 */
export function buildDrilldownResult(result: DrilldownResult): string {
  return JSON.stringify(result, null, 2);
}
