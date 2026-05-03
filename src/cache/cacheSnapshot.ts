import * as vscode from 'vscode';
import type { CachedFileExport } from './cacheTypes';

export async function readAllCacheFilesFromRoot(rootUri: vscode.Uri): Promise<Map<string, CachedFileExport>> {
  const result = new Map<string, CachedFileExport>();

  for (const sub of ['walks-manual', 'walks-auto'] as const) {
    const subUri = vscode.Uri.joinPath(rootUri, sub);
    try {
      const files = await findJsonFiles(subUri, subUri);
      for (const { relPath, uri } of files) {
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const data: CachedFileExport = JSON.parse(Buffer.from(raw).toString('utf-8'));
          const key = relPath.replace(/\.json$/, '');

          if (result.has(key)) {
            const existing = result.get(key)!;
            for (const [symbolName, entry] of Object.entries(data.symbols)) {
              if (!existing.symbols[symbolName]) {
                existing.symbols[symbolName] = entry;
              }
            }
          } else {
            result.set(key, data);
          }
        } catch {
          // skip malformed files
        }
      }
    } catch {
      // skip missing sub directories
    }
  }

  return result;
}

async function findJsonFiles(
  baseUri: vscode.Uri,
  currentUri: vscode.Uri,
): Promise<Array<{ relPath: string; uri: vscode.Uri }>> {
  const result: Array<{ relPath: string; uri: vscode.Uri }> = [];

  try {
    const entries = await vscode.workspace.fs.readDirectory(currentUri);
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(currentUri, name);
      if (type === vscode.FileType.File && name.endsWith('.json')) {
        const relPath = childUri.path.slice(baseUri.path.length + 1);
        result.push({ relPath, uri: childUri });
      } else if (type === vscode.FileType.Directory) {
        result.push(...await findJsonFiles(baseUri, childUri));
      }
    }
  } catch {
    // permission or non-existent
  }

  return result;
}