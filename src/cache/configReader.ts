/**
 * configReader.ts — VS Code settings ベースの設定読み込み
 *
 * テンプレートラベル、デフォルト色、アノテーションスタイル等を
 * `codeWalker.*` 設定から読み込む。
 */

import * as vscode from 'vscode';
import type { ViewMode } from '@walker/blockStore';
import { log } from '@utils/logger';

/** 設定の型 */
export interface CodeWalkerConfig {
  templateLabels: string[];
  defaultColor: number;
  annotationStyle: string;
  viewMode: ViewMode;
  skipPatterns: string[];
  extensions: string[];
}

/**
 * VS Code settings から設定を読み込む。
 */
export function loadConfig(): CodeWalkerConfig {
  const cfg = vscode.workspace.getConfiguration('codeWalker');
  const config: CodeWalkerConfig = {
    templateLabels: cfg.get<string[]>('templateLabels', [
      'Initialization', 'Validation', 'Main Logic', 'Error Handling', 'Cleanup', 'Helper',
    ]),
    defaultColor: cfg.get<number>('defaultColor', 0),
    annotationStyle: cfg.get<string>('annotationStyle', 'italic'),
    viewMode: cfg.get<ViewMode>('viewMode', 'both'),
    skipPatterns: cfg.get<string[]>('skipPatterns', [
      'node_modules', '\\.min\\.(js|css)$', '/dist/', '/build/', '/out/',
      '__pycache__', '\\.pyc$', '\\.d\\.ts$', '\\.generated\\.', '\\.g\\.',
      '/vendor/', '/\\.git/', '/\\.vscode/', '/\\.code-walker/',
    ]),
    extensions: cfg.get<string[]>('extensions', [
      '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs', '.cs',
      '.rb', '.php', '.swift', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp',
    ]),
  };
  log('loadConfig', { viewMode: config.viewMode, defaultColor: config.defaultColor, extensionCount: config.extensions.length, skipPatternCount: config.skipPatterns.length });
  return config;
}
