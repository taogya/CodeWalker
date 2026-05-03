"""簡易データベースアクセス層。"""

import sqlite3
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class Database:
    """SQLite ラッパー。接続管理とクエリ実行を提供する。"""

    def __init__(self, url: str) -> None:
        self._url = url
        self._conn: Optional[sqlite3.Connection] = None

    def connect(self) -> None:
        """データベースに接続する。"""
        db_path = self._url.replace("sqlite:///", "")
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        logger.info("Connected to database: %s", db_path)

    def disconnect(self) -> None:
        """データベース接続を閉じる。"""
        if self._conn:
            self._conn.close()
            self._conn = None
            logger.info("Database disconnected")

    def ping(self) -> bool:
        """接続が有効か確認する。"""
        if not self._conn:
            return False
        try:
            self._conn.execute("SELECT 1")
            return True
        except sqlite3.Error:
            return False

    def run_migrations(self) -> None:
        """初期テーブルを作成する（簡易マイグレーション）。"""
        if not self._conn:
            raise RuntimeError("Database not connected")

        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        self._conn.commit()
        logger.info("Migrations completed")

    def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        """SELECT クエリを実行し、辞書のリストを返す。"""
        if not self._conn:
            raise RuntimeError("Database not connected")

        cursor = self._conn.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def query_one(self, sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
        """SELECT クエリを実行し、1件の辞書を返す。見つからなければ None。"""
        results = self.query(sql, params)
        return results[0] if results else None

    def execute(self, sql: str, params: tuple = ()) -> int:
        """INSERT/UPDATE/DELETE を実行し、lastrowid を返す。"""
        if not self._conn:
            raise RuntimeError("Database not connected")

        cursor = self._conn.execute(sql, params)
        self._conn.commit()
        return cursor.lastrowid or 0
