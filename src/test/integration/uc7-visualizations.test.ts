import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { cleanCodeWalkerCache, closeAllEditors, getExtensionExports, type ExtensionExports } from './helpers';

suite('UC7-UC8: Graph & Timeline', () => {
  let exports: ExtensionExports;

  suiteSetup(async () => {
    exports = await getExtensionExports();
  });

  setup(async () => {
    exports.blockStore.clear();
    exports.testHooks.clearAllDecorations();
    cleanCodeWalkerCache();
    cleanupSnapshotRoots();
    cleanupGraphFixtures();
    await closeAllEditors();
  });

  teardown(async () => {
    exports.blockStore.clear();
    exports.testHooks.clearAllDecorations();
    cleanCodeWalkerCache();
    cleanupSnapshotRoots();
    cleanupGraphFixtures();
    await closeAllEditors();
  });

  test('UC7.1: Symbol Graph は walkthrough / targets / import / reference を統合する', async () => {
    const fixture = await createGraphFixtures();

    await exports.cacheService.writeFile('walks-manual', fixture.mainFilePath, {
      version: '1.0',
      filePath: fixture.mainFilePath,
      symbols: {
        main: {
          symbolName: 'main',
          overview: 'main flow',
          updatedAt: new Date().toISOString(),
          source: 'manual',
          blocks: [{ label: 'Main Flow', startLine: 3, endLine: 5, colorIndex: 0 }],
        },
      },
    });

    await writeTargetsFile({
      version: '1.0',
      createdAt: new Date().toISOString(),
      config: { path: 'graph-fixtures', level: 'function', extensions: ['.py'] },
      skipped: [],
      summary: {},
      targets: [
        { filePath: fixture.mainFilePath, symbolName: 'main', kind: 'function', line: 3, status: 'done' },
        { filePath: fixture.helperFilePath, symbolName: 'Helper', kind: 'class', line: 1, status: 'pending' },
      ],
    });

    await exports.testHooks.refreshSidebar();
    const graph = await exports.testHooks.getGraphSnapshot();

    const mainSymbol = graph.nodes.find(node => node.id === `symbol::${fixture.mainFilePath}::main`);
    const helperSymbol = graph.nodes.find(node => node.id === `symbol::${fixture.helperFilePath}::Helper`);
    assert.ok(mainSymbol, 'main symbol node が存在するべき');
    assert.ok(helperSymbol, 'Helper symbol node が存在するべき');
    assert.strictEqual(helperSymbol!.status, 'none', 'targets 由来の未整備 symbol は none 扱いになるべき');

    assert.ok(
      graph.edges.some(edge => edge.kind === 'contains' && edge.from === `file::${fixture.mainFilePath}` && edge.to === `symbol::${fixture.mainFilePath}::main`),
      'file -> symbol contains edge が必要',
    );
    assert.ok(
      graph.edges.some(edge => edge.kind === 'imports' && edge.from === `file::${fixture.mainFilePath}` && edge.to === `file::${fixture.helperFilePath}`),
      'main.py -> helper.py の import edge が必要',
    );
    assert.ok(
      graph.edges.some(edge => edge.kind === 'references' && edge.from === `symbol::${fixture.mainFilePath}::main` && edge.to === `symbol::${fixture.helperFilePath}::Helper`),
      'main symbol -> Helper symbol の reference edge が必要',
    );
  });

  test('UC8.1: Timeline は複数 snapshot root を時系列ポイントへ正規化する', async () => {
    await exports.cacheService.writeFile('walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'current manual greet',
          updatedAt: '2026-04-12T10:00:00.000Z',
          source: 'manual',
          blocks: [{ label: 'Current Greet', startLine: 14, endLine: 20, colorIndex: 0 }],
        },
      },
    });

    const snapshotRootA = await createSnapshotRoot('snap-a');
    const snapshotRootB = await createSnapshotRoot('snap-b');

    await writeSnapshotCache(snapshotRootA, 'walks-auto', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'auto greet',
          updatedAt: '2026-04-10T10:00:00.000Z',
          source: 'auto',
          blocks: [{ label: 'Auto Greet', startLine: 14, endLine: 20, colorIndex: 1 }],
        },
      },
    });
    await writeSnapshotCache(snapshotRootB, 'walks-manual', 'sample.py', {
      version: '1.0',
      filePath: 'sample.py',
      symbols: {
        greet: {
          symbolName: 'greet',
          overview: 'manual greet v2',
          updatedAt: '2026-04-11T10:00:00.000Z',
          source: 'manual',
          blocks: [
            { label: 'Greet Header', startLine: 14, endLine: 17, colorIndex: 0 },
            { label: 'Greet Return', startLine: 18, endLine: 20, colorIndex: 1 },
          ],
        },
      },
    });

    const timeline = await exports.testHooks.getTimelineData([snapshotRootA, snapshotRootB]);

    assert.deepStrictEqual(
      timeline.snapshots.map(snapshot => snapshot.label),
      ['snap-a', 'snap-b', 'Current'],
      '追加 snapshot root の後に Current が並ぶべき',
    );

    const greetRow = timeline.symbols.find(symbol => symbol.key === 'sample.py::greet');
    assert.ok(greetRow, 'greet row が存在するべき');
    assert.deepStrictEqual(
      greetRow!.points.map(point => ({ source: point.source, blocks: point.blockCount })),
      [
        { source: 'auto', blocks: 1 },
        { source: 'manual', blocks: 2 },
        { source: 'manual', blocks: 1 },
      ],
    );
    assert.strictEqual(greetRow!.points[1].changeMagnitude, 2, 'auto -> manual 変更と block 数増加が changeMagnitude に反映されるべき');
  });
});

function cleanupSnapshotRoots(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }
  const root = path.join(workspaceFolder.uri.fsPath, '.timeline-snapshots');
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function cleanupGraphFixtures(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }
  const root = path.join(workspaceFolder.uri.fsPath, 'graph-fixtures');
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function createGraphFixtures(): Promise<{ mainFilePath: string; helperFilePath: string }> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }

  const root = vscode.Uri.joinPath(workspaceFolder.uri, 'graph-fixtures');
  await vscode.workspace.fs.createDirectory(root);

  const helperFilePath = 'graph-fixtures/helper.py';
  const mainFilePath = 'graph-fixtures/main.py';
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(workspaceFolder.uri, helperFilePath),
    Buffer.from('class Helper:\n    def run(self) -> int:\n        return 1\n', 'utf-8'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(workspaceFolder.uri, mainFilePath),
    Buffer.from('from helper import Helper\n\ndef main() -> int:\n    helper = Helper()\n    return helper.run()\n', 'utf-8'),
  );

  return { mainFilePath, helperFilePath };
}

async function createSnapshotRoot(name: string): Promise<vscode.Uri> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }
  const root = vscode.Uri.joinPath(workspaceFolder.uri, '.timeline-snapshots', name);
  await vscode.workspace.fs.createDirectory(root);
  return root;
}

async function writeSnapshotCache(
  rootUri: vscode.Uri,
  subDir: 'walks-manual' | 'walks-auto',
  cacheRelPath: string,
  data: unknown,
): Promise<void> {
  const parentDir = path.posix.dirname(cacheRelPath);
  const targetDir = parentDir && parentDir !== '.'
    ? vscode.Uri.joinPath(rootUri, subDir, parentDir)
    : vscode.Uri.joinPath(rootUri, subDir);
  await vscode.workspace.fs.createDirectory(targetDir);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(rootUri, subDir, `${cacheRelPath}.json`),
    Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
  );
}

async function writeTargetsFile(data: {
  version: string;
  createdAt: string;
  config: { path: string; level: string; extensions: string[] };
  targets: Array<{ filePath: string; symbolName: string; kind: string; line: number; status: 'pending' | 'done' | 'skip' }>;
  skipped: unknown[];
  summary: Record<string, unknown>;
}): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder found');
  }

  const codeWalkerDir = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker');
  await vscode.workspace.fs.createDirectory(codeWalkerDir);
  const fileUri = vscode.Uri.joinPath(codeWalkerDir, 'targets.json');
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
}
