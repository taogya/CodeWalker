import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // VS Code 本体のインストール先として使うパス
    // out/test/src/test/integration/ → 5階層上がプロジェクトルート
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../../../');

    // テストランナー（index.ts）のパス
    const extensionTestsPath = path.resolve(__dirname, './index');

    // テスト用ワークスペース（fixtures ディレクトリ）
    const testWorkspace = path.resolve(__dirname, '../../../../../src/test/fixtures');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',  // 他の拡張機能を無効化
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
