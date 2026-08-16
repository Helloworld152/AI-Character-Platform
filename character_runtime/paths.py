from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "AI Character Platform"


def get_app_root(explicit_root: Path | None = None) -> Path:
    return (explicit_root or Path(__file__).resolve().parent.parent).resolve()


def get_data_root(explicit_root: Path | None = None) -> Path:
    if explicit_root is not None:
        return explicit_root.resolve()

    configured = os.environ.get("AI_CHARACTER_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    home = Path.home()
    if sys.platform == "darwin":
        base = home / "Library" / "Application Support"
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "").strip()
        if appdata:
            base = Path(appdata)
        else:
            base = home / "AppData" / "Roaming"
    else:
        xdg_data_home = os.environ.get("XDG_DATA_HOME", "").strip()
        if xdg_data_home:
            base = Path(xdg_data_home)
        else:
            base = home / ".local" / "share"
    return (base / APP_NAME).resolve()
