/**
 * findSymbolTool.ts — code_walker_find_symbol ツール
 *
 * ワークスペース内のシンボル（関数/クラス/変数）を名前で検索し、
 * 定義場所（ファイルパス + 行番号）のリストを返す。
 * クロスファイル参照の解決に使用する。
 */

import * as vscode from 'vscode';
import { log } from '@utils/logger';

/** ツール入力スキーマ */
interface FindSymbolInput {
  query: string;
  maxResults?: number;
}

/** 検索結果の個々のエントリ */
interface SymbolLocation {
  name: string;
  kind: string;
  filePath: string;
  line: number;
  containerName?: string;
}

export class FindSymbolTool implements vscode.LanguageModelTool<FindSymbolInput> {

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FindSymbolInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { query, maxResults = 10 } = options.input;

    log('FindSymbolTool.invoke', { query, maxResults });

    // ワークスペースシンボル検索
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    );

    if (!symbols || symbols.length === 0) {
      log('FindSymbolTool: no symbols found', { query });
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({
          query,
          results: [],
          message: `No symbols found matching "${query}"`,
        })),
      ]);
    }

    // ワークスペースルートの取得
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

    // SymbolKind を文字列に変換
    const kindNames: Record<number, string> = {
      [vscode.SymbolKind.File]: 'file',
      [vscode.SymbolKind.Module]: 'module',
      [vscode.SymbolKind.Namespace]: 'namespace',
      [vscode.SymbolKind.Package]: 'package',
      [vscode.SymbolKind.Class]: 'class',
      [vscode.SymbolKind.Method]: 'method',
      [vscode.SymbolKind.Property]: 'property',
      [vscode.SymbolKind.Field]: 'field',
      [vscode.SymbolKind.Constructor]: 'constructor',
      [vscode.SymbolKind.Enum]: 'enum',
      [vscode.SymbolKind.Interface]: 'interface',
      [vscode.SymbolKind.Function]: 'function',
      [vscode.SymbolKind.Variable]: 'variable',
      [vscode.SymbolKind.Constant]: 'constant',
      [vscode.SymbolKind.String]: 'string',
      [vscode.SymbolKind.Number]: 'number',
      [vscode.SymbolKind.Boolean]: 'boolean',
      [vscode.SymbolKind.Array]: 'array',
      [vscode.SymbolKind.Object]: 'object',
      [vscode.SymbolKind.Key]: 'key',
      [vscode.SymbolKind.Null]: 'null',
      [vscode.SymbolKind.EnumMember]: 'enumMember',
      [vscode.SymbolKind.Struct]: 'struct',
      [vscode.SymbolKind.Event]: 'event',
      [vscode.SymbolKind.Operator]: 'operator',
      [vscode.SymbolKind.TypeParameter]: 'typeParameter',
    };

    // 結果を整形（上限数まで）
    const results: SymbolLocation[] = symbols
      .slice(0, maxResults)
      .map(sym => {
        const uri = sym.location.uri;
        const line = sym.location.range.start.line + 1; // 1-based

        // ワークスペース相対パスに変換
        let filePath = uri.fsPath;
        if (workspaceRoot) {
          const rootPath = workspaceRoot.fsPath;
          if (filePath.startsWith(rootPath)) {
            filePath = filePath.slice(rootPath.length + 1); // +1 for separator
          }
        }

        const entry: SymbolLocation = {
          name: sym.name,
          kind: kindNames[sym.kind] ?? `unknown(${sym.kind})`,
          filePath,
          line,
        };
        if (sym.containerName) {
          entry.containerName = sym.containerName;
        }
        return entry;
      });

    log('FindSymbolTool: results', { query, count: results.length });

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify({
        query,
        results,
        totalFound: symbols.length,
      })),
    ]);
  }
}
