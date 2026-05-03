/**
 * fileUtils.ts — ファイル操作ユーティリティ
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * ワークスペース相対パスから URI を解決する。
 */
export function resolveFileUri(filePath: string): vscode.Uri {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder is open');
  }
  // 絶対パスならそのまま、相対パスならワークスペースルートからの相対
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }
  return vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
}

/**
 * ファイルを開いてエディタを返す。
 */
export interface OpenFileInEditorOptions {
  preserveFocus?: boolean;
  preferExistingEditor?: boolean;
}

export async function openFileInEditor(
  uri: vscode.Uri,
  options: OpenFileInEditorOptions = {},
): Promise<vscode.TextEditor> {
  if (options.preferExistingEditor) {
    const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
      editor.document.uri.toString() === uri.toString(),
    );

    if (visibleEditor) {
      if (options.preserveFocus) {
        return visibleEditor;
      }
      return vscode.window.showTextDocument(visibleEditor.document, {
        preserveFocus: false,
        viewColumn: visibleEditor.viewColumn,
      });
    }
  }

  const doc = await vscode.workspace.openTextDocument(uri);

  const existingViewColumn = options.preferExistingEditor
    ? findOpenTextTabViewColumn(uri)
    : undefined;

  return vscode.window.showTextDocument(doc, {
    preserveFocus: options.preserveFocus ?? false,
    viewColumn: existingViewColumn,
  });
}

function findOpenTextTabViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

/**
 * 1-based の行番号から vscode.Range を生成する。
 */
export function lineRange(doc: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const start = new vscode.Position(startLine - 1, 0);
  const end = doc.lineAt(Math.min(endLine - 1, doc.lineCount - 1)).range.end;
  return new vscode.Range(start, end);
}

/**
 * ワークスペース相対パスをキャッシュ用相対パスに正規化する。
 *
 * パス区切りを `/` に統一するだけで、ディレクトリ構造をそのままミラーする。
 *
 * 例:
 *   "main.py"              → "main.py"
 *   "src/models/user.py"   → "src/models/user.py"
 *   "src\\handlers\\app.tsx" → "src/handlers/app.tsx"
 */
export function toCacheRelPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * ブロック対象行（startLine〜endLine, 1-based）のテキストの SHA-256 ハッシュを計算する。
 *
 * @returns `sha256:<hex>` 形式の文字列
 */
export async function computeBlockHash(
  uri: vscode.Uri,
  startLine: number,
  endLine: number,
): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lines: string[] = [];
  const start = Math.max(0, startLine - 1);
  const end = Math.min(doc.lineCount - 1, endLine - 1);
  for (let i = start; i <= end; i++) {
    lines.push(doc.lineAt(i).text);
  }
  const text = lines.join('\n');
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return `sha256:${hash}`;
}
