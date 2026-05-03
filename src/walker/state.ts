/**
 * state.ts — コードウォークの状態管理
 *
 * 現在の解析対象（ファイル, シンボル, 深さ）を追跡する。
 */

import * as vscode from 'vscode';
import { log } from '@utils/logger';

/** ウォークセッションの状態 */
export interface WalkState {
  /** 対象ファイルの URI */
  fileUri: vscode.Uri;
  /** 対象シンボル名 */
  symbolName: string;
  /** 現在の解析深度 (1=overview, 2=blocks, 3=lines) */
  depth: number;
  /** 現在フォーカスしている行範囲 (1-based) */
  currentRange?: { startLine: number; endLine: number };
}

/** 現在のウォークセッション（null = 非アクティブ） */
let currentState: WalkState | null = null;

export function getWalkState(): WalkState | null {
  return currentState;
}

export function setWalkState(state: WalkState): void {
  log('setWalkState', { fileUri: state.fileUri.toString(), symbolName: state.symbolName, depth: state.depth, currentRange: state.currentRange });
  currentState = state;
}

export function clearWalkState(): void {
  log('clearWalkState', { hadState: currentState !== null, previousSymbol: currentState?.symbolName });
  currentState = null;
}
