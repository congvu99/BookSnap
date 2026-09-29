from pathlib import Path


def is_within(path: Path, root: Path) -> bool:
    """True when `path` resolves inside `root` (guards against traversal via stored paths)."""
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False
