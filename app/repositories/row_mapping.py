import uuid
from dataclasses import fields
from typing import Any, TypeVar

import aiosqlite

T = TypeVar("T")


def new_id() -> str:
    return uuid.uuid4().hex


def row_to(cls: type[T], row: aiosqlite.Row | None) -> T | None:
    """Build a dataclass from a row, taking only columns the dataclass declares."""
    if row is None:
        return None
    keys = set(row.keys())
    kwargs: dict[str, Any] = {f.name: row[f.name] for f in fields(cls) if f.name in keys}  # type: ignore[arg-type]
    return cls(**kwargs)


def rows_to(cls: type[T], rows: list[aiosqlite.Row]) -> list[T]:
    return [row_to(cls, r) for r in rows]  # type: ignore[misc]
