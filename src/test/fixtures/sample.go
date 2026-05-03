// Package sample は計算機ユーティリティを提供する。
//
// テスト用フィクスチャファイル — Go サンプル
package sample

import (
	"errors"
	"fmt"
	"log"
	"time"
)

// ─── 型定義 ───

// HistoryEntry は計算履歴の1エントリを表す。
type HistoryEntry struct {
	Operation string
	Operands  [2]float64
	Result    float64
	Timestamp time.Time
}

// Calculator は簡単な計算機。
type Calculator struct {
	history      []HistoryEntry
	maxHistory   int
	enableLog    bool
	logger       *log.Logger
}

// ─── コンストラクタ ───

// NewCalculator は新しい Calculator を生成する。
func NewCalculator(maxHistory int, enableLog bool, logger *log.Logger) *Calculator {
	if logger == nil {
		logger = log.Default()
	}
	c := &Calculator{
		history:    make([]HistoryEntry, 0, maxHistory),
		maxHistory: maxHistory,
		enableLog:  enableLog,
		logger:     logger,
	}
	c.log("Calculator created (maxHistory=%d)", maxHistory)
	return c
}

// ─── 公開 API ───

// Add は2つの数を加算して返す。
func (c *Calculator) Add(a, b float64) float64 {
	result := a + b
	c.record("add", a, b, result)
	return result
}

// Multiply は掛け算を行う。
func (c *Calculator) Multiply(a, b float64) float64 {
	result := a * b
	c.record("multiply", a, b, result)
	return result
}

// Divide は割り算を行う。ゼロ除算時はエラーを返す。
func (c *Calculator) Divide(a, b float64) (float64, error) {
	if b == 0 {
		c.log("ERROR: division by zero: %.2f / %.2f", a, b)
		return 0, errors.New("cannot divide by zero")
	}
	result := a / b
	c.record("divide", a, b, result)
	return result, nil
}

// History は計算履歴のコピーを返す。
func (c *Calculator) History() []HistoryEntry {
	copied := make([]HistoryEntry, len(c.history))
	copy(copied, c.history)
	return copied
}

// ClearHistory は履歴をクリアする。
func (c *Calculator) ClearHistory() {
	c.history = c.history[:0]
	c.log("History cleared")
}

// ─── ヘルパー関数 ───

// Greet は挨拶メッセージを返す。
func Greet(name string) string {
	if name == "" {
		return "Hello, World!"
	}
	return fmt.Sprintf("Hello, %s!", name)
}

// ─── 内部メソッド ───

func (c *Calculator) record(op string, a, b, result float64) {
	entry := HistoryEntry{
		Operation: op,
		Operands:  [2]float64{a, b},
		Result:    result,
		Timestamp: time.Now(),
	}
	c.history = append(c.history, entry)
	if len(c.history) > c.maxHistory {
		c.history = c.history[1:]
	}
	c.log("%s(%.2f, %.2f) = %.2f", op, a, b, result)
}

func (c *Calculator) log(format string, args ...interface{}) {
	if c.enableLog {
		c.logger.Printf("[Calculator] "+format, args...)
	}
}
