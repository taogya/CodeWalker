/// <summary>
/// テスト用フィクスチャファイル — C# サンプル
///
/// 計算機ユーティリティ。クラス + インターフェース + 列挙型を含む。
/// </summary>

using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace CodeWalker.Sample
{
    // ─── 列挙型 ───

    /// <summary>演算の種類</summary>
    public enum OperationType
    {
        Add,
        Multiply,
        Divide,
    }

    // ─── インターフェース ───

    /// <summary>計算機の公開契約</summary>
    public interface ICalculator
    {
        double Multiply(double a, double b);
        double Divide(double a, double b);
        IReadOnlyList<HistoryEntry> History { get; }
        void ClearHistory();
    }

    // ─── 履歴エントリ ───

    /// <summary>計算履歴の1エントリ</summary>
    public record HistoryEntry(
        OperationType Operation,
        double[] Operands,
        double Result,
        DateTime Timestamp);

    // ─── メインクラス ───

    /// <summary>
    /// 簡単な計算機クラス。
    /// 四則演算と履歴管理を提供する。
    /// </summary>
    public class Calculator : ICalculator
    {
        private readonly List<HistoryEntry> _history = new();
        private readonly int _maxHistory;
        private readonly ILogger<Calculator> _logger;

        public Calculator(int maxHistory = 100, ILogger<Calculator>? logger = null)
        {
            _maxHistory = maxHistory;
            _logger = logger ?? LoggerFactory
                .Create(b => b.AddConsole())
                .CreateLogger<Calculator>();
            _logger.LogDebug("Calculator instance created");
        }

        // --- 公開 API ---

        /// <summary>掛け算</summary>
        public double Multiply(double a, double b)
        {
            var result = a * b;
            Record(OperationType.Multiply, a, b, result);
            return result;
        }

        /// <summary>割り算（ゼロ除算チェック付き）</summary>
        public double Divide(double a, double b)
        {
            if (b == 0)
            {
                _logger.LogError("Division by zero: {A} / {B}", a, b);
                throw new DivideByZeroException("Cannot divide by zero");
            }
            var result = a / b;
            Record(OperationType.Divide, a, b, result);
            return result;
        }

        /// <summary>履歴を取得</summary>
        public IReadOnlyList<HistoryEntry> History => _history.AsReadOnly();

        /// <summary>履歴をクリア</summary>
        public void ClearHistory()
        {
            _history.Clear();
            _logger.LogInformation("History cleared");
        }

        // --- 内部ヘルパー ---

        private void Record(OperationType op, double a, double b, double result)
        {
            var entry = new HistoryEntry(op, new[] { a, b }, result, DateTime.UtcNow);
            _history.Add(entry);
            if (_history.Count > _maxHistory)
            {
                _history.RemoveAt(0);
            }
            _logger.LogDebug("{Op}({A}, {B}) = {Result}", op, a, b, result);
        }
    }

    // ─── ヘルパー関数 ───

    /// <summary>挨拶ユーティリティ</summary>
    public static class Greeter
    {
        public static string Greet(string? name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return "Hello, World!";
            }
            return $"Hello, {name}!";
        }
    }
}
