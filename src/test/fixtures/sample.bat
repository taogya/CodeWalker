@echo off
REM ============================================================
REM sample.bat — 計算機ユーティリティ（Batch File サンプル）
REM
REM テスト用フィクスチャファイル。
REM サブルーチン・変数・制御構造を含むバッチファイル。
REM ============================================================

setlocal enabledelayedexpansion

REM ─── 定数 ───

set "CALC_VERSION=1.0.0"
set "ENABLE_LOGGING=0"
set "HISTORY_COUNT=0"
set "LOG_FILE=%TEMP%\calculator.log"

REM ─── メイン処理 ───

:main
    set "ENABLE_LOGGING=1"
    call :log_message "INFO" "Calculator started (version %CALC_VERSION%)"

    call :greet %1
    call :calc_add 10 20
    echo 10 + 20 = %RESULT%

    call :calc_multiply 5 6
    echo 5 * 6 = %RESULT%

    call :calc_divide 100 3
    if "%ERRORLEVEL%"=="0" (
        echo 100 / 3 = %RESULT%
    )

    echo Total operations: %HISTORY_COUNT%
    call :clear_history
    goto :eof

REM ─── 計算サブルーチン ───

:calc_add
    set /a "RESULT=%~1 + %~2"
    call :log_message "DEBUG" "add(%~1, %~2) = %RESULT%"
    set /a "HISTORY_COUNT+=1"
    goto :eof

:calc_multiply
    set /a "RESULT=%~1 * %~2"
    call :log_message "DEBUG" "multiply(%~1, %~2) = %RESULT%"
    set /a "HISTORY_COUNT+=1"
    goto :eof

:calc_divide
    if "%~2"=="0" (
        call :log_message "ERROR" "Division by zero: %~1 / %~2"
        echo ERROR: Cannot divide by zero >&2
        exit /b 1
    )
    set /a "RESULT=%~1 / %~2"
    call :log_message "DEBUG" "divide(%~1, %~2) = %RESULT%"
    set /a "HISTORY_COUNT+=1"
    goto :eof

REM ─── ユーティリティ ───

:greet
    if "%~1"=="" (
        echo Hello, World!
    ) else (
        echo Hello, %~1!
    )
    goto :eof

:show_version
    echo Calculator v%CALC_VERSION%
    goto :eof

:clear_history
    set "HISTORY_COUNT=0"
    call :log_message "INFO" "History cleared"
    goto :eof

REM ─── ロギング ───

:log_message
    if "%ENABLE_LOGGING%"=="1" (
        echo [%DATE% %TIME%] [%~1] %~2
        echo [%DATE% %TIME%] [%~1] %~2 >> "%LOG_FILE%"
    )
    goto :eof
