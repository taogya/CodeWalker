/**
 * reverseReader.ts — .reverse-engineer/ ディレクトリの読み取り
 *
 * ReverseEngineer の解析結果（.reverse-engineer/）が存在する場合に
 * その内容を読み取り、LLM プロンプト用のコンテキストとして返す。
 * 存在しない場合は null を返す（フォールバック設計）。
 */

import * as vscode from 'vscode';
import * as path from 'path';

/** ReverseEngineer のコンテキスト情報 */
export interface ReverseEngineerContext {
  /** アーキテクチャ情報（C4 モデル等） */
  architecture?: string;
  /** インターフェース設計 */
  interfaces?: string;
  /** フロー情報（シーケンス図等） */
  flows?: string;
  /** モジュール/関数構造 */
  structure?: {
    moduleMap?: unknown;
    functionMap?: unknown;
  };
}

/**
 * .reverse-engineer/ ディレクトリが存在するか確認する。
 */
async function hasReverseEngineerDir(): Promise<boolean> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  const reverseDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.reverse-engineer');
  try {
    const stat = await vscode.workspace.fs.stat(reverseDir);
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

/**
 * .reverse-engineer/ から解析結果を読み取る。
 * ディレクトリが存在しない場合は null を返す。
 */
export async function loadReverseEngineerContext(
  _filePath?: string,
  _symbolName?: string,
): Promise<ReverseEngineerContext | null> {
  if (!(await hasReverseEngineerDir())) {
    return null;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  const baseDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.reverse-engineer');
  const context: ReverseEngineerContext = {};

  // architecture/ の読み取り
  context.architecture = await readDirContents(
    vscode.Uri.joinPath(baseDir, 'architecture'),
  );

  // interfaces/ の読み取り
  context.interfaces = await readDirContents(
    vscode.Uri.joinPath(baseDir, 'interfaces'),
  );

  // flows/ の読み取り
  context.flows = await readDirContents(
    vscode.Uri.joinPath(baseDir, 'flows'),
  );

  // structure/ の読み取り
  const structureDir = vscode.Uri.joinPath(baseDir, 'structure');
  const moduleMap = await readJsonFile(vscode.Uri.joinPath(structureDir, 'module-map.json'));
  const functionMap = await readJsonFile(vscode.Uri.joinPath(structureDir, 'function-map.json'));
  if (moduleMap || functionMap) {
    context.structure = { moduleMap, functionMap };
  }

  return context;
}

/**
 * ディレクトリ内のすべてのファイル内容を結合して返す。
 */
async function readDirContents(dirUri: vscode.Uri): Promise<string | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    const contents: string[] = [];

    for (const [name, type] of entries) {
      if (type === vscode.FileType.File) {
        const fileUri = vscode.Uri.joinPath(dirUri, name);
        const data = await vscode.workspace.fs.readFile(fileUri);
        contents.push(`--- ${name} ---\n${Buffer.from(data).toString('utf-8')}`);
      }
    }

    return contents.length > 0 ? contents.join('\n\n') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * JSON ファイルをパースして返す。
 */
async function readJsonFile(fileUri: vscode.Uri): Promise<unknown | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(fileUri);
    return JSON.parse(Buffer.from(data).toString('utf-8'));
  } catch {
    return undefined;
  }
}
