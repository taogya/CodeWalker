/**
 * @file sample.h
 * @brief 計算機ユーティリティ — ヘッダーファイル
 *
 * 計算履歴・計算機構造体・関数プロトタイプを定義する。
 */

#ifndef SAMPLE_H
#define SAMPLE_H

#include <stddef.h>

/* ─── 定数マクロ ─── */

#define CALC_MAX_HISTORY  100
#define CALC_PRECISION    10
#define CALC_VERSION      "1.0.0"

/* ─── 型定義 ─── */

/** 計算履歴の1エントリ */
typedef struct {
    char operation[16];
    double operands[2];
    double result;
} HistoryEntry;

/** 計算機コンテキスト */
typedef struct {
    HistoryEntry history[CALC_MAX_HISTORY];
    size_t history_count;
    int enable_logging;
} Calculator;

/* ─── 関数プロトタイプ ─── */

/** 計算機を初期化する */
void calc_init(Calculator *calc, int enable_logging);

/** 2つの数を加算する */
double calc_add(Calculator *calc, double a, double b);

/** 掛け算 */
double calc_multiply(Calculator *calc, double a, double b);

/** 割り算（ゼロ除算チェック付き） */
double calc_divide(Calculator *calc, double a, double b, int *err);

/** 履歴件数を取得 */
size_t calc_history_count(const Calculator *calc);

/** 履歴をクリア */
void calc_clear_history(Calculator *calc);

/** 挨拶メッセージを標準出力に表示 */
void greet(const char *name);

#endif /* SAMPLE_H */
