/**
 * listSymbolsTool.ts — code_walker_list_symbols ツール
 *
 * 指定パス（ファイルまたはフォルダ）内のシンボルを列挙し、
 * codewalker-all バッチ処理のターゲットリストを生成する。
 *
 * - フォルダ指定時は再帰走査
 * - 拡張子ホワイトリストでフィルタ
 * - 空ファイル・生成物・非対応拡張子は skipped に記録
 * - level (function/class/file) で粒度を制御
 * - 結果を .code-walker/targets.json に保存し、ユーザーが編集可能
 * - fromFile 指定時は既存ファイルから読み込み（編集後の再読込用）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { log } from '@utils/logger';
import { loadConfig } from '@cache/configReader';

// ────────── 定数 ──────────

/** 対応拡張子のデフォルトホワイトリスト */
const DEFAULT_EXTENSIONS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx',
  '.java', '.go', '.rs', '.cs',
  '.rb', '.php', '.swift', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp',
]);

/** スキップ対象のディレクトリ / ファイルパターン */
const SKIP_PATTERNS = [
  /node_modules/,
  /\.min\.(js|css)$/,
  /\/dist\//,
  /\/build\//,
  /\/out\//,
  /__pycache__/,
  /\.pyc$/,
  /\.d\.ts$/,
  /\.generated\./,
  /\.g\./,
  /\/vendor\//,
  /\/\.git\//,
  /\/\.vscode\//,
  /\/\.code-walker\//,
];

// ────────── 型定義 ──────────

/** 解析粒度 */
type SymbolLevel = 'function' | 'class' | 'file';

/** ツール入力 */
interface ListSymbolsInput {
  path: string;
  extensions?: string[];
  level?: SymbolLevel;
  fromFile?: string;
}

/** ターゲットエントリ */
interface TargetEntry {
  filePath: string;
  symbolName: string;
  kind: string;
  line: number;
  endLine?: number;
  level?: SymbolLevel;
  status: 'pending' | 'skip' | 'done';
}

/** スキップエントリ */
interface SkippedEntry {
  filePath: string;
  reason: 'empty' | 'unsupported_ext' | 'generated' | 'no_symbols' | 'binary';
}

/** targets.json ファイル構造 */
interface TargetsFile {
  version: string;
  createdAt: string;
  config: {
    path: string;
    level: SymbolLevel;
    extensions: string[];
  };
  targets: TargetEntry[];
  skipped: SkippedEntry[];
  summary: {
    totalFiles: number;
    totalTargets: number;
    skippedFiles: number;
    level: SymbolLevel;
    extensions: string[];
  };
}

/** SymbolKind → 文字列 */
function kindName(kind: vscode.SymbolKind): string {
  const map: Partial<Record<vscode.SymbolKind, string>> = {
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
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.Operator]: 'operator',
    [vscode.SymbolKind.TypeParameter]: 'typeParameter',
  };
  return map[kind] ?? `unknown(${kind})`;
}

// ────────── ツール本体 ──────────

export class ListSymbolsTool implements vscode.LanguageModelTool<ListSymbolsInput> {

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListSymbolsInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { path: inputPath, extensions, level = 'class', fromFile } = options.input;

    log('ListSymbolsTool.invoke', { path: inputPath, extensions, level, fromFile });

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return this.result({ error: 'No workspace folder is open' });
    }

    // ── fromFile モード: 既存の targets.json を再読込 ──
    if (fromFile) {
      return this.loadFromFile(workspaceFolder, fromFile);
    }

    // 拡張子セット構築（設定から取得）
    const config = loadConfig();
    const extSet = extensions && extensions.length > 0
      ? new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`))
      : new Set(config.extensions);

    // 対象 URI を解決
    const targetUri = path.isAbsolute(inputPath)
      ? vscode.Uri.file(inputPath)
      : vscode.Uri.joinPath(workspaceFolder.uri, inputPath);

    // ファイル or フォルダ判定
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(targetUri);
    } catch {
      return this.result({ error: `Path not found: ${inputPath}` });
    }

    const files: vscode.Uri[] = [];
    const skipPats = config.skipPatterns.map(p => new RegExp(p));
    if (stat.type === vscode.FileType.File) {
      files.push(targetUri);
    } else if (stat.type === vscode.FileType.Directory) {
      await this.collectFiles(targetUri, files, extSet, skipPats);
    } else {
      return this.result({ error: `Unsupported path type: ${inputPath}` });
    }

    // ワークスペースルート（相対パス算出用）
    const rootPath = workspaceFolder.uri.fsPath;

    const targets: TargetEntry[] = [];
    const skipped: SkippedEntry[] = [];

    for (const fileUri of files) {
      if (token.isCancellationRequested) { break; }

      const fsPath = fileUri.fsPath;
      const relPath = fsPath.startsWith(rootPath)
        ? fsPath.slice(rootPath.length + 1)
        : fsPath;

      const ext = path.extname(fsPath).toLowerCase();

      // 拡張子チェック
      if (!extSet.has(ext)) {
        skipped.push({ filePath: relPath, reason: 'unsupported_ext' });
        continue;
      }

      // スキップパターンチェック（設定から取得）
      if (skipPats.some(p => p.test(relPath))) {
        skipped.push({ filePath: relPath, reason: 'generated' });
        continue;
      }

      // ファイルを開いてシンボル取得
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(fileUri);
      } catch {
        skipped.push({ filePath: relPath, reason: 'binary' });
        continue;
      }

      // 空ファイルチェック
      if (doc.lineCount === 0 || doc.getText().trim().length === 0) {
        skipped.push({ filePath: relPath, reason: 'empty' });
        continue;
      }

      // DocumentSymbolProvider でシンボル取得
      const symbols = await vscode.commands.executeCommand<
        (vscode.DocumentSymbol | vscode.SymbolInformation)[]
      >('vscode.executeDocumentSymbolProvider', fileUri);

      if (!symbols || symbols.length === 0) {
        skipped.push({ filePath: relPath, reason: 'no_symbols' });
        continue;
      }

      // DocumentSymbol 型に正規化
      const docSymbols = this.normalizeSymbols(symbols, doc);

      // level に応じてターゲット抽出
      const before = targets.length;
      this.extractTargets(relPath, docSymbols, level, targets);

      // フォールバック: function/class level でターゲット0 → file レベルで再抽出
      // 定数のみのファイル等がスキップされるのを防ぐ
      if (targets.length === before && level !== 'file') {
        log('extractTargets: no targets found, fallback to file level', { filePath: relPath, level });
        this.extractTargets(relPath, docSymbols, 'file', targets);
      }
    }

    // ソート: ファイルパス → 行番号順
    targets.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);

    const summary = {
      totalFiles: files.length,
      totalTargets: targets.length,
      skippedFiles: skipped.length,
      level,
      extensions: [...extSet],
    };

    log('ListSymbolsTool: done', summary);

    // ── targets.json に保存 ──
    const targetsFileData: TargetsFile = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      config: {
        path: inputPath,
        level,
        extensions: [...extSet],
      },
      targets,
      skipped,
      summary,
    };

    const savedPath = await this.saveTargetsFile(workspaceFolder, targetsFileData);

    return this.result({ targets, skipped, summary, savedTo: savedPath });
  }

  // ────────── 内部メソッド ──────────

  /**
   * ディレクトリを再帰走査してファイルを収集する。
   */
  private async collectFiles(
    dirUri: vscode.Uri,
    out: vscode.Uri[],
    extSet: Set<string>,
    skipPats: RegExp[] = [],
  ): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);

    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);

      if (type === vscode.FileType.Directory) {
        // スキップ対象ディレクトリは再帰しない
        if (skipPats.some(p => p.test(name + '/'))) { continue; }
        await this.collectFiles(childUri, out, extSet, skipPats);
      } else if (type === vscode.FileType.File) {
        const ext = path.extname(name).toLowerCase();
        if (extSet.has(ext)) {
          out.push(childUri);
        }
      }
    }
  }

  /**
   * SymbolInformation[] と DocumentSymbol[] を DocumentSymbol[] に正規化。
   */
  private normalizeSymbols(
    symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[],
    doc: vscode.TextDocument,
  ): vscode.DocumentSymbol[] {
    if (symbols.length === 0) { return []; }

    // DocumentSymbol なら children がある
    const first = symbols[0];
    if ('children' in first) {
      return symbols as vscode.DocumentSymbol[];
    }

    // SymbolInformation → DocumentSymbol (children なし)
    return (symbols as vscode.SymbolInformation[]).map(si => {
      const range = si.location.range;
      return new vscode.DocumentSymbol(
        si.name,
        '',
        si.kind,
        range,
        range,
      );
    });
  }

  /**
   * level に基づいてシンボルからターゲットを抽出する。
   *
   * - function: 全関数/メソッドを個別ターゲット
   * - class:    クラス単位 + トップレベル関数
   * - file:     ファイル全体を1ターゲット
   */
  private extractTargets(
    filePath: string,
    symbols: vscode.DocumentSymbol[],
    level: SymbolLevel,
    out: TargetEntry[],
  ): void {
    if (level === 'file') {
      // ファイル全体: 最初のシンボルの名前を代表に使う
      // → トップレベルシンボル名をカンマ区切り or ファイル名
      const topNames = symbols.slice(0, 5).map(s => s.name);
      const symbolName = topNames.join(', ') + (symbols.length > 5 ? ', …' : '');
      const firstLine = symbols.reduce((min, s) => Math.min(min, s.range.start.line + 1), Infinity);
      const lastLine = symbols.reduce((max, s) => Math.max(max, s.range.end.line + 1), 0);

      out.push({
        filePath,
        symbolName: symbolName || path.basename(filePath),
        kind: 'file',
        line: firstLine,
        endLine: lastLine,
        status: 'pending',
      });
      return;
    }

    for (const sym of symbols) {
      const k = sym.kind;
      const startLine = sym.range.start.line + 1;
      const endLine = sym.range.end.line + 1;

      if (level === 'function') {
        // 関数/メソッド → 個別ターゲット
        if (this.isFunctionLike(k)) {
          out.push({
            filePath,
            symbolName: sym.name,
            kind: kindName(k),
            line: startLine,
            endLine,
            status: 'pending',
          });
        }
        // クラス内のメソッドも展開
        if (this.isClassLike(k) && sym.children) {
          for (const child of sym.children) {
            if (this.isFunctionLike(child.kind)) {
              out.push({
                filePath,
                symbolName: `${sym.name}.${child.name}`,
                kind: kindName(child.kind),
                line: child.range.start.line + 1,
                endLine: child.range.end.line + 1,
                status: 'pending',
              });
            }
          }
        }
      } else {
        // level === 'class'
        // クラス/インターフェース/Enum → クラス単位
        if (this.isClassLike(k)) {
          out.push({
            filePath,
            symbolName: sym.name,
            kind: kindName(k),
            line: startLine,
            endLine,
            status: 'pending',
          });
        }
        // トップレベル関数 → 個別ターゲット
        else if (this.isFunctionLike(k)) {
          out.push({
            filePath,
            symbolName: sym.name,
            kind: kindName(k),
            line: startLine,
            endLine,
            status: 'pending',
          });
        }
        // トップレベル変数/定数（重要なもの）
        else if (k === vscode.SymbolKind.Variable || k === vscode.SymbolKind.Constant) {
          // 短い変数定義（5行以下）はスキップ
          if (endLine - startLine >= 5) {
            out.push({
              filePath,
              symbolName: sym.name,
              kind: kindName(k),
              line: startLine,
              endLine,
              status: 'pending',
            });
          }
        }
      }
    }
  }

  private isFunctionLike(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Function
      || kind === vscode.SymbolKind.Method
      || kind === vscode.SymbolKind.Constructor;
  }

  private isClassLike(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Class
      || kind === vscode.SymbolKind.Interface
      || kind === vscode.SymbolKind.Enum
      || kind === vscode.SymbolKind.Struct;
  }

  /**
   * targets.json を .code-walker/ に保存し、エディタで開く。
   */
  private async saveTargetsFile(
    workspaceFolder: vscode.WorkspaceFolder,
    data: TargetsFile,
  ): Promise<string> {
    const codeWalkerDir = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker');
    try { await vscode.workspace.fs.createDirectory(codeWalkerDir); } catch { /* exists */ }

    const fileUri = vscode.Uri.joinPath(codeWalkerDir, 'targets.json');
    const content = JSON.stringify(data, null, 2);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));

    // エディタで開く（ユーザーが確認・編集できるように）
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch {
      // エディタで開けなくても保存は成功
    }

    const relativePath = '.code-walker/targets.json';
    log('Targets file saved', { path: relativePath, targets: data.targets.length });
    return relativePath;
  }

  /**
   * 既存の targets.json を読み込み、pending ターゲットのみ返す。
   */
  private async loadFromFile(
    workspaceFolder: vscode.WorkspaceFolder,
    filePath: string,
  ): Promise<vscode.LanguageModelToolResult> {
    const fileUri = path.isAbsolute(filePath)
      ? vscode.Uri.file(filePath)
      : vscode.Uri.joinPath(workspaceFolder.uri, filePath);

    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(fileUri);
    } catch {
      return this.result({ error: `Targets file not found: ${filePath}` });
    }

    let data: TargetsFile;
    try {
      data = JSON.parse(Buffer.from(raw).toString('utf-8'));
    } catch {
      return this.result({ error: `Invalid JSON in targets file: ${filePath}` });
    }

    // status でフィルタ: pending のみ処理対象
    const pendingTargets = data.targets.filter(t => t.status === 'pending');
    const skippedByUser = data.targets.filter(t => t.status === 'skip');
    const doneTargets = data.targets.filter(t => t.status === 'done');

    const summary = {
      totalTargets: data.targets.length,
      pendingTargets: pendingTargets.length,
      skippedByUser: skippedByUser.length,
      doneTargets: doneTargets.length,
      level: data.config.level,
      extensions: data.config.extensions,
    };

    log('ListSymbolsTool: loaded from file', summary);

    return this.result({
      targets: pendingTargets,
      skipped: data.skipped,
      summary,
      loadedFrom: filePath,
    });
  }

  private result(data: Record<string, unknown>): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(data)),
    ]);
  }
}

// ────────── バッチ進捗管理 ──────────

/**
 * targets.json 内の指定エントリのステータスを 'done' に更新する。
 *
 * ExportTool の batchMode 完了時に呼ばれ、
 * 中断→再開時に完了済みターゲットをスキップできるようにする。
 */
export async function markTargetDone(filePath: string, symbolName: string): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }

  const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.code-walker', 'targets.json');

  let raw: Uint8Array;
  try {
    raw = await vscode.workspace.fs.readFile(fileUri);
  } catch {
    log('markTargetDone: targets.json not found');
    return;
  }

  let data: TargetsFile;
  try {
    data = JSON.parse(Buffer.from(raw).toString('utf-8'));
  } catch {
    log('markTargetDone: invalid JSON');
    return;
  }

  let updated = false;
  for (const t of data.targets) {
    if (t.filePath === filePath && t.symbolName === symbolName && t.status === 'pending') {
      t.status = 'done';
      updated = true;
      break;
    }
  }

  if (updated) {
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
    log('markTargetDone: updated', { filePath, symbolName });
  }
}
