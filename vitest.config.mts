import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    include: ['src/test/unit/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@analysis': path.resolve(__dirname, 'src/analysis'),
      '@cache': path.resolve(__dirname, 'src/cache'),
      '@commands': path.resolve(__dirname, 'src/commands'),
      '@tools': path.resolve(__dirname, 'src/tools'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@walker': path.resolve(__dirname, 'src/walker'),
      // vscode モジュールはモックに差し替え
      'vscode': path.resolve(__dirname, 'src/test/unit/__mocks__/vscode.ts'),
    },
  },
});
