"""アプリケーション設定管理モジュール。"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml  # type: ignore


@dataclass
class Config:
    """アプリケーション設定。"""

    app_name: str = "SampleApp"
    version: str = "0.1.0"
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"
    database_url: str = "sqlite:///app.db"
    allowed_origins: list[str] = field(default_factory=lambda: ["*"])


def load_config(path: Path) -> Config:
    """YAML ファイルから設定を読み込む。

    ファイルが存在しない場合はデフォルト設定を返す。
    """
    if not path.exists():
        return Config()

    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    return Config(
        app_name=raw.get("app_name", Config.app_name),
        version=raw.get("version", Config.version),
        host=raw.get("host", Config.host),
        port=raw.get("port", Config.port),
        log_level=raw.get("log_level", Config.log_level),
        database_url=raw.get("database_url", Config.database_url),
        allowed_origins=raw.get("allowed_origins", Config.allowed_origins.default_factory()),  # type: ignore
    )


def validate_config(config: Config) -> list[str]:
    """設定値のバリデーションを行い、エラーメッセージのリストを返す。"""
    errors: list[str] = []

    if not config.app_name:
        errors.append("app_name is required")
    if not (1 <= config.port <= 65535):
        errors.append(f"port must be 1-65535, got {config.port}")
    if config.log_level.upper() not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        errors.append(f"Invalid log_level: {config.log_level}")
    if not config.database_url:
        errors.append("database_url is required")

    return errors
