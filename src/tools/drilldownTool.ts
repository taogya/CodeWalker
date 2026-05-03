/**
 * drilldownTool.ts — code_walker_drilldown ツール
 *
 * ユーザーに QuickPick で質問入力または終了を選択させる。
 *
 * - 自由テキスト入力で質問や指示を送信
 * - ESC でウォークスルー終了
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { buildDrilldownResult, type DrilldownResult } from '@analysis/contextBuilder';
import { log } from '@utils/logger';

/** ツール入力スキーマ */
interface DrilldownInput {
  /** QuickPick に表示するメッセージ（任意） */
  message?: string;
}

export class DrilldownTool implements vscode.LanguageModelTool<DrilldownInput> {

  constructor(private readonly _context: vscode.ExtensionContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DrilldownInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { message } = options.input;
    log('DrilldownTool.invoke() called', { message });

    const userInput = await this._showInputQuickPick(message);

    // ESC / キャンセル → 終了
    if (!userInput) {
      const result: DrilldownResult = { finished: true };
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(buildDrilldownResult(result)),
      ]);
    }

    // テキスト入力 → 質問
    log('DrilldownTool user question', { question: userInput });
    const result: DrilldownResult = {
      finished: false,
      question: userInput,
    };
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(buildDrilldownResult(result)),
    ]);
  }

  /**
   * 質問入力用 QuickPick。
   * - テキスト入力して Enter → string
   * - ESC → undefined
   */
  private _showInputQuickPick(
    message?: string,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick();
      qp.title = message ?? l10n.t('Enter a question or instruction (ESC to finish)');
      qp.placeholder = l10n.t('Enter a question/instruction and press Enter, or ESC to end walkthrough');
      qp.items = [];
      qp.ignoreFocusOut = true;

      let resolved = false;

      qp.onDidAccept(() => {
        if (resolved) { return; }
        const text = qp.value.trim();
        if (text) {
          resolved = true;
          qp.dispose();
          resolve(text);
        }
        // 空文字で Enter → 何もしない
      });

      qp.onDidHide(() => {
        if (resolved) { return; }
        resolved = true;
        qp.dispose();
        resolve(undefined);
      });

      qp.show();
    });
  }
}
