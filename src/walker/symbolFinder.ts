/**
 * symbolFinder.ts — DocumentSymbolProvider を使ったシンボル検索
 *
 * 関数名・クラス名から VS Code の DocumentSymbol を取得し、
 * Range（位置情報）を返す。
 */

import * as vscode from 'vscode';
import { log } from '@utils/logger';

/**
 * ドキュメント内の全シンボルを取得する。
 */
async function getDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    uri,
  );
  return symbols ?? [];
}

/**
 * シンボル名で再帰検索する。
 *
 * @param symbols DocumentSymbol の配列
 * @param name 検索するシンボル名
 * @returns 見つかった DocumentSymbol（見つからなければ undefined）
 */
function findSymbolByName(
  symbols: vscode.DocumentSymbol[],
  name: string,
): vscode.DocumentSymbol | undefined {
  for (const sym of symbols) {
    if (sym.name === name) {
      return sym;
    }
    // 子シンボル（クラス内メソッド等）を再帰検索
    const found = findSymbolByName(sym.children, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * ドキュメントからシンボルを名前で検索する。
 *
 * @param uri 対象ファイルの URI
 * @param symbolName 関数名またはクラス名
 * @returns 見つかった DocumentSymbol（見つからなければ undefined）
 */
export async function findSymbol(
  uri: vscode.Uri,
  symbolName: string,
): Promise<vscode.DocumentSymbol | undefined> {
  const symbols = await getDocumentSymbols(uri);
  log('findSymbol', { uri: uri.toString(), symbolName, totalSymbols: symbols.length });
  const found = findSymbolByName(symbols, symbolName);
  if (!found) {
    log('findSymbol: not found', { symbolName, availableTopLevel: symbols.map(s => s.name) });
  }
  return found;
}
