"""HTTP ミドルウェア モジュール。"""

import logging
import time
from http.server import BaseHTTPRequestHandler
from typing import Callable

logger = logging.getLogger(__name__)

MiddlewareFunc = Callable[[type], type]


def log_request(handler_class: type) -> type:
    """リクエストのログを記録するミドルウェア。"""
    original_do_GET = getattr(handler_class, "do_GET", None)
    original_do_POST = getattr(handler_class, "do_POST", None)

    def timed_do_GET(self: BaseHTTPRequestHandler) -> None:
        start = time.time()
        if original_do_GET:
            original_do_GET(self)
        elapsed = (time.time() - start) * 1000
        logger.info("GET %s — %.1fms", self.path, elapsed)

    def timed_do_POST(self: BaseHTTPRequestHandler) -> None:
        start = time.time()
        if original_do_POST:
            original_do_POST(self)
        elapsed = (time.time() - start) * 1000
        logger.info("POST %s — %.1fms", self.path, elapsed)

    handler_class.do_GET = timed_do_GET  # type: ignore
    handler_class.do_POST = timed_do_POST  # type: ignore
    return handler_class


def apply_middleware(handler_class: type, middlewares: list[MiddlewareFunc]) -> type:
    """ミドルウェアを順に適用する。"""
    for mw in middlewares:
        handler_class = mw(handler_class)
    return handler_class
