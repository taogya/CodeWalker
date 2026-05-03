"""
テスト用フィクスチャファイル — UC3 マニュアルモード検証用

シンプルな関数を含むファイル。
ブロック追加・編集・削除のテストに使用する。
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def greet(name: str) -> str:
    """挨拶メッセージを返す"""
    logger.debug("greet called with name=%s", name)
    if not name:
        logger.info("No name provided, using default greeting")
        return "Hello, World!"
    return f"Hello, {name}!"


def add(a: int, b: int) -> int:
    """2つの数を加算する"""
    logger.debug("add(%d, %d)", a, b)
    result = a + b
    return result


def configure_logging(level: Optional[str] = None) -> None:
    """ロギング設定を初期化する"""
    log_level = getattr(logging, (level or "INFO").upper(), logging.INFO)
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("Logging configured at level %s", logging.getLevelName(log_level))


class Calculator:
    """簡単な計算機クラス"""

    def __init__(self) -> None:
        self.history: list[str] = []
        self._logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        self._logger.debug("Calculator instance created")

    def multiply(self, a: int, b: int) -> int:
        """掛け算"""
        self._logger.debug("multiply(%d, %d)", a, b)
        result = a * b
        self.history.append(f"{a} * {b} = {result}")
        return result

    def divide(self, a: int, b: int) -> float:
        """割り算（ゼロ除算チェック付き）"""
        self._logger.debug("divide(%d, %d)", a, b)
        if b == 0:
            self._logger.error("Division by zero attempted: %d / %d", a, b)
            raise ValueError("Cannot divide by zero")
        result = a / b
        self.history.append(f"{a} / {b} = {result}")
        return result
