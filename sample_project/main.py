"""
サンプル Web アプリケーション — CodeWalker 動作検証用

Flask ライクな構造を持つシンプルな HTTP サーバー。
関数の階層構造・外部参照・ブロック分割のテストに使用する。
"""

import json
import logging
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any

from config import load_config, Config
from database import Database
from middleware import apply_middleware, log_request

logger = logging.getLogger(__name__)


def main() -> None:
    """アプリケーションのエントリーポイント。

    1. 設定読み込み・バリデーション
    2. データベース初期化
    3. ミドルウェア登録
    4. HTTP サーバー起動
    """
    # --- 初期化処理 ---
    config = load_config(Path("config.yaml"))
    setup_logging(config.log_level)
    logger.info("Starting application: %s v%s", config.app_name, config.version)

    # --- データベース接続 ---
    db = Database(config.database_url)
    db.connect()
    db.run_migrations()
    logger.info("Database connected: %s", config.database_url)

    # --- ミドルウェア登録 ---
    handler_class = create_handler(db, config)
    handler_class = apply_middleware(handler_class, [log_request])

    # --- サーバー起動 ---
    server = HTTPServer((config.host, config.port), handler_class)
    logger.info("Server listening on %s:%d", config.host, config.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        db.disconnect()
        server.server_close()


def setup_logging(level: str) -> None:
    """ロギングの初期設定を行う。"""
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def create_handler(db: "Database", config: "Config") -> type:
    """リクエストハンドラクラスを動的に生成する。

    クロージャを使ってハンドラに db と config を注入する。
    """

    class RequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            """GET リクエストを処理する。"""
            route = self.path.rstrip("/")

            if route == "" or route == "/":
                self._handle_index()
            elif route == "/health":
                self._handle_health()
            elif route.startswith("/api/users"):
                self._handle_users(route)
            else:
                self._handle_not_found()

        def do_POST(self) -> None:
            """POST リクエストを処理する。"""
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON"}, status=400)
                return

            if self.path == "/api/users":
                self._handle_create_user(data)
            else:
                self._handle_not_found()

        # --- レスポンスヘルパー ---

        def _send_json(self, data: Any, status: int = 200) -> None:
            """JSON レスポンスを送信する。"""
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        # --- ルートハンドラ ---

        def _handle_index(self) -> None:
            self._send_json({
                "app": config.app_name,
                "version": config.version,
                "status": "running",
            })

        def _handle_health(self) -> None:
            is_healthy = db.ping()
            status = 200 if is_healthy else 503
            self._send_json({"healthy": is_healthy}, status=status)

        def _handle_users(self, route: str) -> None:
            """ユーザー一覧 or 個別ユーザー取得。"""
            parts = route.split("/")
            if len(parts) == 3:
                # /api/users → 一覧
                users = db.query("SELECT id, name, email FROM users")
                self._send_json({"users": users})
            elif len(parts) == 4:
                # /api/users/<id> → 個別
                user_id = parts[3]
                user = db.query_one(
                    "SELECT id, name, email FROM users WHERE id = ?",
                    (user_id,),
                )
                if user:
                    self._send_json(user)
                else:
                    self._send_json({"error": "User not found"}, status=404)
            else:
                self._handle_not_found()

        def _handle_create_user(self, data: dict) -> None:
            """ユーザーを新規作成する。"""
            name = data.get("name")
            email = data.get("email")
            if not name or not email:
                self._send_json(
                    {"error": "name and email are required"}, status=400
                )
                return
            user_id = db.execute(
                "INSERT INTO users (name, email) VALUES (?, ?)",
                (name, email),
            )
            self._send_json({"id": user_id, "name": name, "email": email}, status=201)

        def _handle_not_found(self) -> None:
            self._send_json({"error": "Not Found"}, status=404)

    return RequestHandler


if __name__ == "__main__":
    main()
