/**
 * テスト用フィクスチャファイル — TypeScript サンプル
 *
 * 計算機ユーティリティ。クラス + 関数 + 型定義を含む。
 */

import { EventEmitter } from "events";

// ─── 型定義 ───

/** 計算履歴の1エントリ */
export interface HistoryEntry {
  operation: string;
  operands: number[];
  result: number;
  timestamp: Date;
}

/** 計算機の設定 */
export interface CalculatorOptions {
  precision: number;
  maxHistory: number;
  enableLogging: boolean;
}

// ─── 定数 ───

const DEFAULT_OPTIONS: CalculatorOptions = {
  precision: 10,
  maxHistory: 100,
  enableLogging: false,
};

// ─── ヘルパー関数 ───

/**
 * 数値を指定精度で丸める
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * 2つの数を加算する
 */
export function add(a: number, b: number): number {
  return a + b;
}

// ─── メインクラス ───

/**
 * 簡単な計算機クラス
 *
 * 四則演算と履歴管理を提供する。
 */
export class Calculator extends EventEmitter {
  private history: HistoryEntry[] = [];
  private options: CalculatorOptions;

  constructor(options?: Partial<CalculatorOptions>) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.log("Calculator instance created");
  }

  // --- 公開 API ---

  /** 掛け算 */
  multiply(a: number, b: number): number {
    const result = roundTo(a * b, this.options.precision);
    this.record("multiply", [a, b], result);
    return result;
  }

  /** 割り算（ゼロ除算チェック付き） */
  divide(a: number, b: number): number {
    if (b === 0) {
      this.log("Division by zero attempted");
      throw new Error("Cannot divide by zero");
    }
    const result = roundTo(a / b, this.options.precision);
    this.record("divide", [a, b], result);
    return result;
  }

  /** 履歴を取得 */
  getHistory(): ReadonlyArray<HistoryEntry> {
    return [...this.history];
  }

  /** 履歴をクリア */
  clearHistory(): void {
    this.history = [];
    this.emit("historyCleared");
    this.log("History cleared");
  }

  // --- 内部ヘルパー ---

  private record(operation: string, operands: number[], result: number): void {
    const entry: HistoryEntry = {
      operation,
      operands,
      result,
      timestamp: new Date(),
    };
    this.history.push(entry);
    if (this.history.length > this.options.maxHistory) {
      this.history.shift();
    }
    this.emit("calculated", entry);
    this.log(`${operation}(${operands.join(", ")}) = ${result}`);
  }

  private log(message: string): void {
    if (this.options.enableLogging) {
      console.log(`[Calculator] ${message}`);
    }
  }
}
