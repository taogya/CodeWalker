/**
 * logger.ts — ファイルベースのデバッグロガー
 *
 * Extension Development Host 内の動作をファイルに記録する。
 * ログファイルは拡張のグローバルストレージ内に作成される。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let logFilePath: string | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let debugEnabled = true;

/**
 * ロガーを初期化する。
 * @param context 拡張コンテキスト
 */
export function initLogger(context: vscode.ExtensionContext): void {
  // ログファイルのパスを決定（ワークスペースルートに .code-walker-debug.log）
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    logFilePath = path.join(workspaceFolders[0].uri.fsPath, '.code-walker-debug.log');
  } else {
    // ワークスペースがない場合はグローバルストレージ
    logFilePath = path.join(context.globalStorageUri.fsPath, 'debug.log');
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  }

  // 設定から ON/OFF を読み込み
  debugEnabled = vscode.workspace.getConfiguration('codeWalker').get<boolean>('enableDebugLog', false);

  // 設定変更を監視
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codeWalker.enableDebugLog')) {
        debugEnabled = vscode.workspace.getConfiguration('codeWalker').get<boolean>('enableDebugLog', false);
      }
    }),
  );

  // Output Channel は常に作成（手動で開けるように）
  outputChannel = vscode.window.createOutputChannel('CodeWalker');
  context.subscriptions.push(outputChannel);

  if (!debugEnabled) { return; }

  // 起動時にログファイルをクリア
  fs.writeFileSync(logFilePath, `=== CodeWalker Debug Log ===\nStarted: ${new Date().toISOString()}\n\n`);

  log('Logger initialized', { logFilePath });
}

/**
 * デバッグログを書き出す。
 */
export function log(message: string, data?: unknown): void {
  if (!debugEnabled) { return; }

  const timestamp = new Date().toISOString();
  const entry = data
    ? `[${timestamp}] ${message}\n  ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}\n`
    : `[${timestamp}] ${message}\n`;

  // ファイルに追記
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, entry);
    } catch {
      // ファイル書き込み失敗は無視
    }
  }

  // Output Channel にも出力
  if (outputChannel) {
    outputChannel.appendLine(entry.trimEnd());
  }

  // コンソールにも出力
  console.log(`[CodeWalker] ${message}`, data ?? '');
}
