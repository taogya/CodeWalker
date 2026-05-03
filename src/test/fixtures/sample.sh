#!/usr/bin/env bash
# ============================================================
# sample.sh — 計算機ユーティリティ（Shell Script サンプル）
#
# テスト用フィクスチャファイル。
# 関数定義・変数・制御構造を含むシェルスクリプト。
# ============================================================

set -euo pipefail

# ─── 定数 ───

readonly CALC_VERSION="1.0.0"
readonly MAX_HISTORY=100
readonly LOG_FILE="/tmp/calculator.log"

# ─── グローバル変数 ───

HISTORY_COUNT=0
ENABLE_LOGGING=0

# ─── ロギング ───

log_message() {
    local level="$1"
    shift
    if [[ "$ENABLE_LOGGING" -eq 1 ]]; then
        printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" | tee -a "$LOG_FILE"
    fi
}

# ─── 計算関数 ───

calc_add() {
    local a="$1"
    local b="$2"
    local result
    result=$(echo "$a + $b" | bc -l)
    log_message "DEBUG" "add($a, $b) = $result"
    HISTORY_COUNT=$((HISTORY_COUNT + 1))
    echo "$result"
}

calc_multiply() {
    local a="$1"
    local b="$2"
    local result
    result=$(echo "$a * $b" | bc -l)
    log_message "DEBUG" "multiply($a, $b) = $result"
    HISTORY_COUNT=$((HISTORY_COUNT + 1))
    echo "$result"
}

calc_divide() {
    local a="$1"
    local b="$2"

    if [[ "$b" == "0" || "$b" == "0.0" ]]; then
        log_message "ERROR" "Division by zero: $a / $b"
        echo "ERROR: Cannot divide by zero" >&2
        return 1
    fi

    local result
    result=$(echo "scale=10; $a / $b" | bc -l)
    log_message "DEBUG" "divide($a, $b) = $result"
    HISTORY_COUNT=$((HISTORY_COUNT + 1))
    echo "$result"
}

# ─── ユーティリティ ───

greet() {
    local name="${1:-}"
    if [[ -z "$name" ]]; then
        echo "Hello, World!"
    else
        echo "Hello, ${name}!"
    fi
}

show_version() {
    echo "Calculator v${CALC_VERSION}"
}

clear_history() {
    HISTORY_COUNT=0
    log_message "INFO" "History cleared"
}

# ─── メイン処理 ───

main() {
    ENABLE_LOGGING=1
    log_message "INFO" "Calculator started (version $CALC_VERSION)"

    greet "$@"

    local sum
    sum=$(calc_add 10 20)
    echo "10 + 20 = $sum"

    local product
    product=$(calc_multiply 5 6)
    echo "5 * 6 = $product"

    local quotient
    if quotient=$(calc_divide 100 3); then
        echo "100 / 3 = $quotient"
    fi

    echo "Total operations: $HISTORY_COUNT"
    clear_history
}

# スクリプトとして直接実行された場合のみ main を呼ぶ
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
