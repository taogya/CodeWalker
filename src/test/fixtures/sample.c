/**
 * @file sample.c
 * @brief 計算機ユーティリティ — ソースファイル
 *
 * sample.h で宣言された関数の実装。
 */

#include "sample.h"
#include <stdio.h>
#include <string.h>

/* ─── 内部ヘルパー ─── */

/**
 * 計算履歴に1件追加する（内部関数）
 */
static void record(Calculator *calc,
                   const char *operation,
                   double a, double b, double result)
{
    if (calc->history_count >= CALC_MAX_HISTORY) {
        /* 古い履歴をシフト */
        memmove(&calc->history[0], &calc->history[1],
                sizeof(HistoryEntry) * (CALC_MAX_HISTORY - 1));
        calc->history_count = CALC_MAX_HISTORY - 1;
    }

    HistoryEntry *entry = &calc->history[calc->history_count];
    strncpy(entry->operation, operation, sizeof(entry->operation) - 1);
    entry->operation[sizeof(entry->operation) - 1] = '\0';
    entry->operands[0] = a;
    entry->operands[1] = b;
    entry->result = result;
    calc->history_count++;

    if (calc->enable_logging) {
        printf("[Calculator] %s(%.2f, %.2f) = %.2f\n",
               operation, a, b, result);
    }
}

/* ─── 公開 API ─── */

void calc_init(Calculator *calc, int enable_logging)
{
    memset(calc, 0, sizeof(Calculator));
    calc->enable_logging = enable_logging;
    if (enable_logging) {
        printf("[Calculator] Initialized (version %s)\n", CALC_VERSION);
    }
}

double calc_add(Calculator *calc, double a, double b)
{
    double result = a + b;
    record(calc, "add", a, b, result);
    return result;
}

double calc_multiply(Calculator *calc, double a, double b)
{
    double result = a * b;
    record(calc, "multiply", a, b, result);
    return result;
}

double calc_divide(Calculator *calc, double a, double b, int *err)
{
    if (b == 0.0) {
        if (calc->enable_logging) {
            fprintf(stderr,
                    "[Calculator] ERROR: Division by zero: %.2f / %.2f\n",
                    a, b);
        }
        if (err) {
            *err = 1;
        }
        return 0.0;
    }

    if (err) {
        *err = 0;
    }
    double result = a / b;
    record(calc, "divide", a, b, result);
    return result;
}

size_t calc_history_count(const Calculator *calc)
{
    return calc->history_count;
}

void calc_clear_history(Calculator *calc)
{
    calc->history_count = 0;
    if (calc->enable_logging) {
        printf("[Calculator] History cleared\n");
    }
}

void greet(const char *name)
{
    if (name == NULL || name[0] == '\0') {
        printf("Hello, World!\n");
        return;
    }
    printf("Hello, %s!\n", name);
}
