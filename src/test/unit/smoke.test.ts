/**
 * Unit テスト: スモークテスト（基盤動作確認用）
 *
 * vitest + vscode モックが正しくセットアップされていることを確認する最小テスト。
 * 実際のユースケーステストは別ファイルに実装する。
 */
import { describe, it, expect } from 'vitest';

describe('Unit Test Smoke Test', () => {
  it('vitest が正しく動作すること', () => {
    expect(1 + 1).toBe(2);
  });

  it('vscode モックがインポートできること', async () => {
    const vscode = await import('vscode');
    expect(vscode.Uri.file).toBeDefined();
    expect(vscode.workspace).toBeDefined();
    expect(vscode.window).toBeDefined();
  });
});
