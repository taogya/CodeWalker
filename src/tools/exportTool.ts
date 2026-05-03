/**
 * exportTool.ts — code_walker_export ツール
 *
 * ウォークスルーの結果を JSON / Markdown ファイルとして保存する。
 * 保存前にユーザーにフォーマット選択を確認する。
 * JSON は walks-auto/ にディレクトリミラー形式で保存する。
 *
 * A-2 リファクタリング: CacheService 経由でキャッシュ I/O。
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { toCacheRelPath, resolveFileUri, computeBlockHash } from '@utils/fileUtils';
import { log } from '@utils/logger';
import { notifyInfo } from '@utils/notifications';
import { buildWalkthroughMarkdown } from '@utils/walkthroughMarkdown';
import { CacheService } from '@cache/cacheService';
import type { CachedFileExport, CachedSymbolEntry, CachedBlock } from '@cache/cacheTypes';
import { markTargetDone } from '@tools/listSymbolsTool';
import type { BlockStore } from '@walker/blockStore';

/** ブロック情報（ツール入力） */
interface ExportBlock {
  label: string;
  startLine: number;
  endLine: number;
  description?: string;
  explanation?: string;
  annotations?: { line: number; text: string }[];
}

/** ツール入力スキーマ */
interface ExportInput {
  filePath: string;
  symbolName: string;
  overview: string;
  blocks: ExportBlock[];
  batchMode?: boolean;
}

/** QuickPick 選択肢の値 */
type ExportFormat = 'json' | 'markdown' | 'both' | 'cancel';

export class ExportTool implements vscode.LanguageModelTool<ExportInput> {

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _cacheService: CacheService,
    private readonly _blockStore: BlockStore,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExportInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, symbolName, overview, blocks, batchMode } = options.input;
    log('ExportTool.invoke() called', { filePath, symbolName, blockCount: blocks.length, batchMode });

    let format: ExportFormat;

    if (batchMode) {
      // バッチモード: QuickPick をスキップし JSON 自動保存
      format = 'json';
    } else {
      // 通常モード: ユーザーにフォーマット選択
      const choice = await vscode.window.showQuickPick(
        [
          { label: l10n.t('$(json) Save as JSON'), description: l10n.t('Machine-readable — reusable as cache'), value: 'json' as ExportFormat },
          { label: l10n.t('$(markdown) Save as Markdown'), description: l10n.t('Human-readable document'), value: 'markdown' as ExportFormat },
          { label: l10n.t('$(files) Save both'), description: l10n.t('JSON + Markdown'), value: 'both' as ExportFormat },
          { label: l10n.t('$(close) Don\'t save'), value: 'cancel' as ExportFormat },
        ],
        {
          title: l10n.t('Save walkthrough results?'),
          placeHolder: `${filePath} — ${symbolName}`,
          ignoreFocusOut: true,
        },
      );

      if (!choice || choice.value === 'cancel') {
        log('Export cancelled by user');
        return this.result({ exported: false, reason: 'cancelled' });
      }

      format = choice.value;
    }

    // 保存先ディレクトリ確認
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return this.result({ exported: false, reason: 'no workspace folder' });
    }

    // ソースディレクトリ構造をミラーするキャッシュパス
    const cacheRelPath = toCacheRelPath(filePath);

    const savedFiles: string[] = [];

    // JSON 保存（ファイル単位: 既存の JSON を読み込み、シンボルを追加/更新）
    if (format === 'json' || format === 'both') {
      // ファイルURI解決
      const sourceUri = resolveFileUri(filePath);

      // 既存ファイルがあれば読み込み
      let fileExport: CachedFileExport;
      const existing = await this._cacheService.readFile('walks-auto', cacheRelPath);
      fileExport = existing ?? { version: '1.0', filePath, symbols: {} };

      // ブロックを CachedBlock 型に変換（BlockStore のメモリ上 explanation を補完 + ブロック単位ハッシュ）
      const cachedBlocks: CachedBlock[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        // LLM 入力に explanation があればそれを使い、無ければ BlockStore から取得
        const explanation = b.explanation || this._blockStore.getExplanation(sourceUri, symbolName, i);
        let blockHash = '';
        try {
          blockHash = await computeBlockHash(sourceUri, b.startLine, b.endLine);
        } catch (err) {
          log('ExportTool: failed to compute block hash', { error: String(err), block: b.label });
        }
        cachedBlocks.push({
          label: b.label,
          startLine: b.startLine,
          endLine: b.endLine,
          colorIndex: i % 6,
          description: b.description,
          explanation,
          annotations: b.annotations,
          blockHash,
        });
      }
      log('ExportTool: blocks with explanations', {
        symbolName,
        blockCount: cachedBlocks.length,
        explanationsFromStore: cachedBlocks.filter(b => b.explanation && !blocks[cachedBlocks.indexOf(b)]?.explanation).length,
        explanationsFromInput: cachedBlocks.filter((_, i) => blocks[i]?.explanation).length,
      });

      // シンボルエントリを追加/更新
      const symbolEntry: CachedSymbolEntry = {
        symbolName,
        overview,
        updatedAt: new Date().toISOString(),
        source: 'auto',
        blocks: cachedBlocks,
      };
      fileExport.symbols[symbolName] = symbolEntry;

      await this._cacheService.writeFile('walks-auto', cacheRelPath, fileExport);
      savedFiles.push(`.code-walker/walks-auto/${cacheRelPath}.json`);
      log('Exported JSON', { cacheRelPath, symbolName });
    }

    // Markdown 保存（シンボル単位: walks-auto/{relPath}/ 内に個別ファイル）
    if (format === 'markdown' || format === 'both') {
      const walksAutoDir = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', 'walks-auto');
      const mdDir = vscode.Uri.joinPath(walksAutoDir, cacheRelPath);
      try { await vscode.workspace.fs.createDirectory(mdDir); } catch { /* exists */ }
      const md = buildWalkthroughMarkdown(filePath, symbolName, overview, blocks);
      const mdName = `${symbolName}.md`;
      const mdUri = vscode.Uri.joinPath(mdDir, mdName);
      await vscode.workspace.fs.writeFile(mdUri, Buffer.from(md, 'utf-8'));
      savedFiles.push(`.code-walker/walks-auto/${cacheRelPath}/${mdName}`);
      log('Exported Markdown', { path: mdUri.fsPath });
    }

    const formatLabel = format === 'both' ? l10n.t('JSON + Markdown') : format === 'json' ? 'JSON' : 'Markdown';
    void notifyInfo(l10n.t('CodeWalker: Saved as {0}', formatLabel));

    // バッチモード: targets.json のステータスを done に更新
    if (batchMode) {
      await markTargetDone(filePath, symbolName);
    }

    log('ExportTool.invoke() completed', { filePath, symbolName, format, savedFiles, batchMode });

    return this.result({ exported: true, format, paths: savedFiles });
  }

  private result(data: Record<string, unknown>): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(data)),
    ]);
  }
}
