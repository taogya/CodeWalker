/**
 * Integration テスト: スモークテスト（基盤動作確認用）
 *
 * テスト基盤が正しくセットアップされていることを確認するための最小テスト。
 * 実際のユースケーステストは別ファイルに実装する。
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Smoke Test', () => {
  test('拡張機能がアクティベートされること', async () => {
    // 開発モードでは publisher が undefined になる場合がある
    const allExtensions = vscode.extensions.all;
    const ext = allExtensions.find(e =>
      e.id.includes('code-walker') || e.id.includes('CodeWalker')
    );
    assert.ok(ext, `Extension should be found. Available: ${allExtensions.map(e => e.id).filter(id => !id.startsWith('vscode.')).join(', ')}`);

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, 'Extension should be active');
  });

  test('コマンドが登録されていること', async () => {
    // onStartupFinished の発火を待つ
    await new Promise(resolve => setTimeout(resolve, 2000));

    const commands = await vscode.commands.getCommands(true);
    const cwCommands = commands.filter(c => c.startsWith('codeWalker.'));
    assert.ok(
      cwCommands.length > 0,
      `CodeWalker commands should be registered. Found ${cwCommands.length} commands`,
    );
  });
});
