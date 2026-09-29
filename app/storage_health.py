"""Detect a deploy that would silently lose data: running on Railway with DATA_DIR not on a Volume."""

import os
from pathlib import Path

from app.file_paths import is_within


def data_dir_durability_error(data_dir: Path, env: dict[str, str] | None = None) -> str | None:
    env = dict(os.environ) if env is None else env
    if "RAILWAY_ENVIRONMENT_NAME" not in env and "RAILWAY_ENVIRONMENT_ID" not in env:
        return None
    mount = env.get("RAILWAY_VOLUME_MOUNT_PATH")
    if not mount:
        return "no Railway volume attached"
    if not is_within(data_dir, Path(mount)):
        return f"DATA_DIR is not inside volume mount {mount}"
    return None
