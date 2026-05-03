/**
 * cacheService.ts — キャッシュ I/O 集約サービス
 *
 * .code-walker/walks-manual/ と walks-auto/ への読み書きを一元管理する。
 * 各コマンド・ツール・パネルが直接ファイル I/O を行わず、
 * このサービスを経由して操作する。
 *
 * A-2 (散在する Cache I/O) を解消するリファクタリング。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { CachedFileExport } from './cacheTypes';
import { log } from '@utils/logger';

/** キャッシュサブディレクトリ */
export type CacheSubDir = 'walks-manual' | 'walks-auto';

/**
 * キャッシュ JSON ファイルの読み書き・削除を集約するサービス。
 */
export class CacheService {

  // ── 内部ヘルパー ────────────────────────────

  /** ワークスペースルート URI */
  private get _wsRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  /** .code-walker ディレクトリ URI */
  private _cwDir(): vscode.Uri {
    const ws = this._wsRoot;
    if (!ws) { throw new Error('No workspace folder is open'); }
    return vscode.Uri.joinPath(ws, '.code-walker');
  }

  /** サブディレクトリ URI */
  private _subDir(sub: CacheSubDir): vscode.Uri {
    return vscode.Uri.joinPath(this._cwDir(), sub);
  }

  // ── 公開 API ────────────────────────────────

  /** ワークスペースが開かれているか */
  hasWorkspace(): boolean {
    return !!this._wsRoot;
  }

  // ── 読み取り ─────────────────────────────────

  /**
   * 指定サブディレクトリのキャッシュ JSON を読み込む。
   * ファイルが見つからなければ null。
   */
  async readFile(sub: CacheSubDir, cacheRelPath: string): Promise<CachedFileExport | null> {
    try {
      const uri = vscode.Uri.joinPath(this._subDir(sub), cacheRelPath + '.json');
      const raw = await vscode.workspace.fs.readFile(uri);
      const data = JSON.parse(Buffer.from(raw).toString('utf-8'));
      log('CacheService.readFile', {
        sub, cacheRelPath,
        symbolCount: Object.keys(data.symbols ?? {}).length,
        fileHash: data.fileHash ? data.fileHash.slice(0, 20) + '...' : '(none)',
      });
      return data;
    } catch (err) {
      log('CacheService.readFile: not found or error', { sub, cacheRelPath, error: String(err) });
      return null;
    }
  }

  // ── 書き込み ─────────────────────────────────

  /**
   * 指定サブディレクトリにキャッシュ JSON を書き込む。
   * 必要な中間ディレクトリを自動作成する。
   */
  async writeFile(sub: CacheSubDir, cacheRelPath: string, data: CachedFileExport): Promise<void> {
    const dir = this._subDir(sub);
    const parentDir = path.posix.dirname(cacheRelPath);
    const targetDir = parentDir && parentDir !== '.'
      ? vscode.Uri.joinPath(dir, parentDir)
      : dir;
    try { await vscode.workspace.fs.createDirectory(targetDir); } catch { /* exists */ }

    const uri = vscode.Uri.joinPath(dir, cacheRelPath + '.json');
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
    log('CacheService.writeFile', {
      sub, cacheRelPath,
      symbolCount: Object.keys(data.symbols ?? {}).length,
      symbolNames: Object.keys(data.symbols ?? {}),
    });
  }

  // ── 削除 ─────────────────────────────────────

  /**
   * キャッシュ JSON ファイルを削除する。
   * @returns 削除できたら true
   */
  async deleteFile(sub: CacheSubDir, cacheRelPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(this._subDir(sub), cacheRelPath + '.json'),
      );
      log('CacheService.deleteFile', { sub, cacheRelPath, success: true });
      return true;
    } catch (err) {
      log('CacheService.deleteFile: failed', { sub, cacheRelPath, error: String(err) });
      return false;
    }
  }

  /**
   * Markdown エクスポートディレクトリ等を再帰削除する。
   * @returns 削除できたら true
   */
  async deleteDir(sub: CacheSubDir, cacheRelPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(this._subDir(sub), cacheRelPath),
        { recursive: true },
      );
      log('CacheService.deleteDir', { sub, cacheRelPath, success: true });
      return true;
    } catch (err) {
      log('CacheService.deleteDir: failed', { sub, cacheRelPath, error: String(err) });
      return false;
    }
  }

  /**
   * サブディレクトリ全体を削除する（walks-manual/ または walks-auto/）。
   */
  async deleteSubDir(sub: CacheSubDir): Promise<void> {
    log('CacheService.deleteSubDir', { sub });
    await vscode.workspace.fs.delete(this._subDir(sub), { recursive: true });
    log('CacheService.deleteSubDir: completed', { sub });
  }
}
