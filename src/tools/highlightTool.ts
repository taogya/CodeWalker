/**
 * highlightTool.ts — code_walker_highlight ツール
 *
 * AI が定義したブロックの色分け・CodeLens 登録、
 * 行末アノテーションの表示、ブロック解説の保存を行う。
 *
 * A-4 リファクタリング: 循環参照を解消 — BlockStore をコンストラクタ注入。
 */

import * as vscode from 'vscode';
import { buildSymbolOwnerKey, highlightBlocks, setAnnotations, type BlockRange, type LineAnnotation } from '@walker/highlighter';
import { resolveFileUri, openFileInEditor, lineRange } from '@utils/fileUtils';
import type { BlockStore } from '@walker/blockStore';
import type { BlockInfo } from '@analysis/contextBuilder';
import { getWalkState } from '@walker/state';
import { log } from '@utils/logger';

/** AI 定義ブロック入力 */
interface BlockInput {
  label: string;
  startLine: number;
  endLine: number;
  description?: string;
}

/** アノテーション入力 */
interface AnnotationInput {
  line: number;
  text: string;
}

/** ブロック解説入力 */
interface ExplanationInput {
  blockIndex: number;
  text: string;
}

/** ツール入力スキーマ */
interface HighlightInput {
  filePath: string;
  symbolName?: string;
  blocks?: BlockInput[];
  annotations?: AnnotationInput[];
  explanations?: ExplanationInput[];
}

export class HighlightTool implements vscode.LanguageModelTool<HighlightInput> {

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _blockStore: BlockStore,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<HighlightInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, symbolName: inputSymbolName, blocks, annotations, explanations } = options.input;
    log('HighlightTool.invoke() called', {
      filePath,
      symbolName: inputSymbolName,
      blockCount: blocks?.length,
      annotationCount: annotations?.length,
      explanationCount: explanations?.length,
    });

    // シンボル名解決: 入力 > walkState > フォールバック
    const walkState = getWalkState();
    const symbolName = inputSymbolName ?? walkState?.symbolName ?? 'unknown';

    // ファイルを開く
    const uri = resolveFileUri(filePath);
    const editor = await openFileInEditor(uri);
    const doc = editor.document;

    // AI 定義ブロックで色分け + CodeLens を上書き
    if (blocks && blocks.length > 0 && this._blockStore) {
      const blockInfos: BlockInfo[] = blocks.map((b, i) => ({
        index: i,
        label: b.label,
        description: b.description,
        startLine: b.startLine,
        endLine: b.endLine,
        colorIndex: i % 6,
      }));

      // 色分けハイライト再適用
      const blockRanges: BlockRange[] = blockInfos.map(b => ({
        range: lineRange(doc, b.startLine, b.endLine),
        colorIndex: b.colorIndex,
      }));
      highlightBlocks(editor, blockRanges, buildSymbolOwnerKey(symbolName, 'auto'));

      // CodeLens 再登録（シンボル単位） — AI 経由は常に 'auto' ソース
      this._blockStore.setBlocks(uri, symbolName, blockInfos, 'auto');
      log('Blocks overridden by AI', { symbolName, blockCount: blockInfos.length, labels: blockInfos.map(b => b.label) });
    }

    // アノテーション表示
    if (annotations && annotations.length > 0) {
      const lineAnnotations: LineAnnotation[] = annotations.map(a => ({
        line: a.line,
        text: a.text,
      }));
      setAnnotations(editor, lineAnnotations, buildSymbolOwnerKey(symbolName, 'auto'));
    }

    // ブロック解説を BlockStore に保存
    let explanationsStored = 0;
    if (explanations && explanations.length > 0 && this._blockStore) {
      for (const exp of explanations) {
        this._blockStore.setExplanation(uri, symbolName, exp.blockIndex, exp.text);
        explanationsStored++;
      }
      log('HighlightTool: explanations stored', { symbolName, explanationsStored });
    }

    log('HighlightTool.invoke() completed', {
      filePath, symbolName,
      blocksApplied: blocks?.length ?? 0,
      annotationsApplied: annotations?.length ?? 0,
      explanationsStored,
    });

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        JSON.stringify({
          highlighted: true,
          filePath,
          blocksApplied: blocks?.length ?? 0,
          annotationsApplied: annotations?.length ?? 0,
          explanationsStored,
        }),
      ),
    ]);
  }
}
