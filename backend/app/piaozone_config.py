"""RPA platform environment configurations.

Loads configuration from piaozone_config.json with optional environment variable overrides.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parent / "piaozone_config.json"


def load_raw_config() -> dict[str, Any]:
    """Load raw JSON configuration from piaozone_config.json."""
    custom_path = os.getenv("PIAONZONE_CONFIG_PATH")
    target_path = Path(custom_path) if custom_path else _CONFIG_PATH
    if target_path.exists():
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error("Failed to load piaozone_config.json from %s: %s", target_path, e)
    return {}


def get_rpa_config(env: str = "sit") -> dict[str, str]:
    """Get RPA order platform config for specified env ('sit' or 'prod')."""
    raw = load_raw_config().get("rpa_platform", {}).get(env.lower(), {})
    env_upper = env.upper()
    return {
        "host": os.getenv(f"RPA_PLATFORM_{env_upper}_HOST", raw.get("host", "")),
        "endpoint": os.getenv(
            f"RPA_PLATFORM_{env_upper}_ENDPOINT",
            raw.get("endpoint", "/trdPlatform/tenant/query/by/company"),
        ),
        "client_id": os.getenv(f"RPA_CLIENT_ID_{env_upper}", raw.get("client_id", "")),
        "client_secret": os.getenv(f"RPA_CLIENT_SECRET_{env_upper}", raw.get("client_secret", "")),
    }


def get_company_title_config() -> dict[str, str]:
    """Get company title query platform config (single environment)."""
    raw = load_raw_config().get("company_title", {})
    return {
        "host": os.getenv("COMPANY_TITLE_HOST", raw.get("host", "https://title.piaozone.com")),
        "endpoint": os.getenv(
            "COMPANY_TITLE_ENDPOINT",
            raw.get("endpoint", "/bill/query/querytitles"),
        ),
        "client_id": os.getenv("COMPANY_TITLE_CLIENT_ID", raw.get("client_id", "XXzM8oZ1FQGLJxZ-YK_svomMUA8")),
        "client_secret": os.getenv("COMPANY_TITLE_CLIENT_SECRET", raw.get("client_secret", "5KcLc2OK2hIrsnbZOR4EzzM1dEM")),
        "encrypt_key": os.getenv("COMPANY_TITLE_ENCRYPT_KEY", raw.get("encrypt_key", "kgr92kHxXNKIU6Cw")),
    }


# Convenience pre-loaded configs
RPA_SIT_CONFIG = get_rpa_config("sit")
RPA_PROD_CONFIG = get_rpa_config("prod")
COMPANY_TITLE_CONFIG = get_company_title_config()

