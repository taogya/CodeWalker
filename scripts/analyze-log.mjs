#!/usr/bin/env node
/**
 * analyze-log.mjs — CodeWalker 包括的ログアナライザー
 *
 * .code-walker-debug.log を解析し:
 *   1. [DIAG:Bn] パターンから既知バグの発生を検出
 *   2. エラー・失敗パターンの自動検出
 *   3. 操作フロー整合性チェック（開始→完了ペア）
 *   4. 異常値・状態不整合の検出
 *   5. 操作タイムラインの生成
 *
 * 使い方:
 *   node scripts/analyze-log.mjs [logFilePath]
 *   node scripts/analyze-log.mjs --verbose [logFilePath]
 *
 * logFilePath 省略時はカレントディレクトリの .code-walker-debug.log を読む。
 */

import fs from 'fs';
import path from 'path';

// ── バグ定義 ────────────────────────────────────
const BUG_DEFINITIONS = {
  B1: {
    pattern: /\[DIAG:B1\]/,
    severity: 'CRITICAL',
    title: 'return before lifecycle code — キャッシュ復元が動作しない',
    description: 'extension.ts で return 文がライフサイクルコード（restoreEditor等）より前にあるため、ファイルオープン時のキャッシュ自動復元が一切機能しない。',
  },
  B4: {
    pattern: /\[DIAG:B4\]/,
    severity: 'ERROR',
    title: 'showBlockDetail called but BlockStore is empty',
    description: 'BlockStore にデータがない状態で CodeLens クリックが発生した。',
  },
  B5: {
    pattern: /\[DIAG:B5\]/,
    severity: 'WARNING',
    title: 'Duplicate block range / Manual+Auto 重複',
    description: '同一シンボルが Manual と Auto の両方のキャッシュに存在する。',
  },
  B6: {
    pattern: /\[DIAG:B6\]/,
    severity: 'ERROR',
    title: 'Block has undefined source — ViewMode フィルタリング不正',
    description: 'キャッシュエントリの source フィールドが undefined。',
  },
  B7: {
    pattern: /\[DIAG:B7\]/,
    severity: 'ERROR',
    title: 'Stale blockIndex — 削除後のインデックス不整合',
    description: 'blockIndex がストア内のブロック数を超えている。',
  },
  B8: {
    pattern: /\[DIAG:B8\]/,
    severity: 'WARNING',
    title: 'Error message lacks file/symbol context',
    description: '"Block info not found." にファイルパスやシンボル名が含まれていない。',
  },
};

// ── 一般異常パターン ────────────────────────────
const ANOMALY_PATTERNS = [
  {
    id: 'ERROR_LOG',
    pattern: /\b(FAILED|failed|error|Error|ERROR)\b/i,
    exclude: /severity|Bug.*ERROR|ERROR:|検出|なし|registered|no symbols found/i,
    severity: 'ERROR',
    title: 'エラー/失敗ログ検出',
  },
  {
    id: 'STACK_TRACE',
    pattern: /\bat\s+\S+\s+\(.*:\d+:\d+\)/,
    severity: 'ERROR',
    title: 'スタックトレース検出',
  },
  {
    id: 'UNDEFINED_NULL',
    pattern: /"?\w+"?\s*:\s*(undefined|null)\b/,
    exclude: /hasExplanation|explanation.*null|previousSymbol.*null/,
    severity: 'WARNING',
    title: 'undefined/null 値検出',
  },
  {
    id: 'NO_WORKSPACE',
    pattern: /no workspace/i,
    severity: 'WARNING',
    title: 'ワークスペース未検出',
  },
  {
    id: 'HASH_MISMATCH',
    pattern: /hashMismatch|hash.*mismatch/i,
    severity: 'WARNING',
    title: 'ファイルハッシュ不一致',
  },
  {
    id: 'NOT_FOUND',
    pattern: /not found|notFound/i,
    exclude: /DIAG|targets\.json not found|no symbols found/,
    severity: 'INFO',
    title: 'リソース未検出',
  },
];

// ── フロー整合性チェック定義 ─────────────────
const FLOW_PAIRS = [
  { start: 'activate() called', end: 'activate() completed', name: 'Extension Activation' },
  { start: 'handleSave start', end: 'handleSave: saved to walks-manual', name: 'Block Save' },
  { start: 'restoreEditor: attempting restore', end: /restoreEditor: (cache restored|no cache)/, name: 'Cache Restore' },
  { start: 'clearCacheCommand start', end: /clearCacheCommand (completed|error)/, name: 'Clear Cache' },
];

// ── ログ解析 ────────────────────────────────────

function parseLogLine(line) {
  // フォーマット: [HH:MM:SS.mmm] message { data }
  const match = line.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s+(.*)/);
  if (!match) return null;
  const timestamp = match[1];
  const rest = match[2];

  // JSON データ部分とメッセージ部分を分離
  let message = rest;
  let data = null;
  const jsonStart = rest.indexOf('{');
  if (jsonStart > 0) {
    message = rest.substring(0, jsonStart).trim();
    try {
      data = JSON.parse(rest.substring(jsonStart));
    } catch {
      // JSON パース失敗 → メッセージ全体
      message = rest;
    }
  }
  return { timestamp, message, data, raw: line };
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const logFilePath = args.filter(a => a !== '--verbose')[0]
    || path.join(process.cwd(), '.code-walker-debug.log');

  if (!fs.existsSync(logFilePath)) {
    console.error(`❌ ログファイルが見つかりません: ${logFilePath}`);
    console.error('   Extension Development Host でエクステンションを実行し、');
    console.error('   操作を行ってからこのスクリプトを実行してください。');
    process.exit(1);
  }

  const content = fs.readFileSync(logFilePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const parsed = lines.map(parseLogLine).filter(Boolean);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CodeWalker 包括的ログ分析レポート');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ログファイル: ${logFilePath}`);
  console.log(`  総行数:       ${lines.length}`);
  console.log(`  解析行数:     ${parsed.length}`);
  console.log('');

  let totalIssues = 0;

  // ──────────────────────────────────────────────
  // 1. 既知バグ [DIAG:Bn] 検出
  // ──────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  1. 既知バグ（DIAG）検出                                │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const diagEntries = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/\[DIAG:(B\d+)\]/);
    if (match) {
      let dataLines = [lines[i]];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^\[/) || lines[j].trim() === '') break;
        dataLines.push(lines[j]);
      }
      diagEntries.push({ bugId: match[1], line: i + 1, text: dataLines.join('\n') });
    }
  }

  const detected = new Map();
  for (const entry of diagEntries) {
    if (!detected.has(entry.bugId)) detected.set(entry.bugId, []);
    detected.get(entry.bugId).push(entry);
  }

  let diagIssues = 0;
  for (const [bugId, def] of Object.entries(BUG_DEFINITIONS)) {
    const entries = detected.get(bugId) || [];
    const icon = entries.length > 0
      ? (def.severity === 'CRITICAL' ? '🔴' : def.severity === 'ERROR' ? '🟠' : '🟡')
      : '✅';
    console.log(`  ${icon} ${bugId}: ${def.title}`);
    if (entries.length > 0) {
      diagIssues++;
      console.log(`     重要度: ${def.severity} | 検出: ${entries.length}回`);
      for (const e of entries.slice(0, 2)) {
        console.log(`     L${e.line}: ${e.text.split('\n')[0].substring(0, 100)}`);
      }
    }
  }
  if (diagIssues === 0) console.log('  ✅ 既知バグパターンは検出されませんでした。');
  totalIssues += diagIssues;
  console.log('');

  // ──────────────────────────────────────────────
  // 2. 一般異常パターン検出
  // ──────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  2. 一般異常パターン検出                                 │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const anomalies = new Map();
  for (const pat of ANOMALY_PATTERNS) {
    anomalies.set(pat.id, []);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // DIAG 行は既知バグとして処理済み → スキップ
    if (/\[DIAG:/.test(line)) continue;

    for (const pat of ANOMALY_PATTERNS) {
      if (pat.pattern.test(line)) {
        if (pat.exclude && pat.exclude.test(line)) continue;
        anomalies.get(pat.id).push({ line: i + 1, text: line });
      }
    }
  }

  let anomalyIssues = 0;
  for (const pat of ANOMALY_PATTERNS) {
    const entries = anomalies.get(pat.id);
    if (entries.length === 0) continue;
    anomalyIssues++;
    const icon = pat.severity === 'ERROR' ? '🟠' : pat.severity === 'WARNING' ? '🟡' : 'ℹ️';
    console.log(`  ${icon} ${pat.title} (${entries.length}件)`);
    const show = verbose ? entries : entries.slice(0, 3);
    for (const e of show) {
      console.log(`     L${e.line}: ${e.text.substring(0, 120)}`);
    }
    if (!verbose && entries.length > 3) {
      console.log(`     ... ほか ${entries.length - 3} 件 (--verbose で全件表示)`);
    }
  }
  if (anomalyIssues === 0) console.log('  ✅ 異常パターンは検出されませんでした。');
  totalIssues += anomalyIssues;
  console.log('');

  // ──────────────────────────────────────────────
  // 3. 操作フロー整合性チェック
  // ──────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  3. 操作フロー整合性チェック                             │');
  console.log('└─────────────────────────────────────────────────────────┘');

  for (const flow of FLOW_PAIRS) {
    const starts = [];
    const ends = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(flow.start)) starts.push(i + 1);
      const endMatch = flow.end instanceof RegExp ? flow.end.test(lines[i]) : lines[i].includes(flow.end);
      if (endMatch) ends.push(i + 1);
    }

    if (starts.length === 0 && ends.length === 0) {
      console.log(`  ── ${flow.name}: 未実行`);
    } else if (starts.length > ends.length) {
      console.log(`  🟠 ${flow.name}: 開始${starts.length}回 > 完了${ends.length}回 — 未完了の操作あり`);
      totalIssues++;
    } else if (starts.length < ends.length) {
      console.log(`  🟡 ${flow.name}: 開始${starts.length}回 < 完了${ends.length}回 — 開始ログ欠落の可能性`);
      totalIssues++;
    } else {
      console.log(`  ✅ ${flow.name}: ${starts.length}回実行 → 全て完了`);
    }
  }
  console.log('');

  // ──────────────────────────────────────────────
  // 4. 操作統計
  // ──────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  4. 操作統計                                            │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const opCounters = {
    'BlockStore.setBlocks': 0,
    'BlockStore.removeBlock': 0,
    'BlockStore.removeSymbol': 0,
    'BlockStore.setExplanation': 0,
    'BlockStore.clear': 0,
    'CacheService.readFile': 0,
    'CacheService.writeFile': 0,
    'highlightBlocks': 0,
    'setAnnotations': 0,
    'restoreFromCache': 0,
    'provideCodeLenses': 0,
    'handleSave start': 0,
    'handlePreview': 0,
    'showBlockDetailPanel': 0,
    'findSymbol': 0,
    'setWalkState': 0,
    'clearWalkState': 0,
    'loadConfig': 0,
    'AnalyzeTool.invoke': 0,
    'HighlightTool.invoke': 0,
    'DrilldownTool.invoke': 0,
    'ExportTool.invoke': 0,
    'FindSymbolTool.invoke': 0,
    'ListSymbolsTool.invoke': 0,
  };

  for (const line of lines) {
    for (const op of Object.keys(opCounters)) {
      if (line.includes(op)) opCounters[op]++;
    }
  }

  const activeOps = Object.entries(opCounters).filter(([, v]) => v > 0);
  const inactiveOps = Object.entries(opCounters).filter(([, v]) => v === 0);

  if (activeOps.length > 0) {
    console.log('  実行された操作:');
    for (const [op, count] of activeOps) {
      console.log(`    ${op}: ${count}回`);
    }
  }
  if (verbose && inactiveOps.length > 0) {
    console.log('  未実行の操作:');
    for (const [op] of inactiveOps) {
      console.log(`    ${op}: 0回`);
    }
  }
  console.log('');

  // ──────────────────────────────────────────────
  // 5. タイムライン（verbose 時のみ）
  // ──────────────────────────────────────────────
  if (verbose) {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│  5. 操作タイムライン                                    │');
    console.log('└─────────────────────────────────────────────────────────┘');
    for (const entry of parsed) {
      const isImportant =
        /DIAG|FAILED|error|activate|deactivate|setBlocks|removeBlock|handleSave|showBlockDetail|restoreFrom|setViewMode/i.test(entry.raw);
      if (isImportant) {
        console.log(`  [${entry.timestamp}] ${entry.message}`);
      }
    }
    console.log('');
  }

  // ──────────────────────────────────────────────
  // サマリー
  // ──────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  if (totalIssues > 0) {
    console.log(`  🔍 検出された問題: ${totalIssues} 件`);
    const criticals = [...detected.keys()].filter(k => BUG_DEFINITIONS[k]?.severity === 'CRITICAL');
    const errors = [...detected.keys()].filter(k => BUG_DEFINITIONS[k]?.severity === 'ERROR');
    if (criticals.length) console.log(`     🔴 CRITICAL: ${criticals.join(', ')}`);
    if (errors.length)    console.log(`     🟠 ERROR:    ${errors.join(', ')}`);
  } else {
    console.log('  ✅ 問題は検出されませんでした。');
  }
  console.log(`  📊 総ログ行: ${lines.length} | DIAG: ${diagEntries.length} | 異常パターン: ${anomalyIssues}`);
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(totalIssues > 0 ? 1 : 0);
}

main();
