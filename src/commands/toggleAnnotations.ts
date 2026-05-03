/**
 * toggleAnnotations.ts — アノテーション表示/非表示トグルコマンド
 */

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { hideAnnotations, reapplyAnnotations } from '@walker/highlighter';
import { log } from '@utils/logger';
import { notifyInfo } from '@utils/notifications';

/** アノテーション表示状態（モジュールスコープ） */
let annotationsVisible = true;

export function toggleAnnotationsCommand(): void {
  const prev = annotationsVisible;
  annotationsVisible = !annotationsVisible;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (annotationsVisible) {
      reapplyAnnotations(editor);
    } else {
      hideAnnotations(editor);
    }
  }
  void notifyInfo(
    l10n.t('CodeWalker: Annotations {0}', annotationsVisible ? 'ON' : 'OFF'),
  );
  log('toggleAnnotationsCommand', { from: prev, to: annotationsVisible, hasEditor: !!editor });
}
