import re
import unicodedata
from dataclasses import dataclass

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to, rows_to

_SPACES = re.compile(r"\s+")


def clean_topic_name(raw: str) -> str:
    return _SPACES.sub(" ", unicodedata.normalize("NFC", raw)).strip()


# Vietnamese alphabet: ă â ê ô ơ ư đ are letters of their own (a < ă < â, o < ô < ơ); tones sort
# after letters, in dictionary order ngang < huyền < hỏi < ngã < sắc < nặng.
_LETTER_MARKS = {"̆": "1", "̂": "2", "̛": "3"}
_TONES = {"̀": "1", "̉": "2", "̃": "3", "́": "4", "̣": "5"}


def vietnamese_sort_key(name: str) -> tuple[str, str]:
    """Order like a Vietnamese dictionary: "An nam" < "Âm nhạc" < "Du ký" < "Đạo đức"."""
    letters, tones = [], []
    for ch in unicodedata.normalize("NFD", clean_topic_name(name).casefold()):
        if ch in _LETTER_MARKS and letters:
            letters[-1] = letters[-1][0] + _LETTER_MARKS[ch]
        elif ch in _TONES and tones:
            tones[-1] = _TONES[ch]
        elif not unicodedata.combining(ch):
            letters.append("d4" if ch == "đ" else ch + "0")
            tones.append("0")
    return "".join(letters), "".join(tones)


def topic_key(name: str) -> str:
    """Identity of a topic: "Văn học" and "VĂN  HỌC" are the same topic.

    SQLite's NOCASE only folds ASCII, so the key is computed here instead.
    """
    return clean_topic_name(name).casefold()


@dataclass(frozen=True)
class Topic:
    id: str
    name: str


@dataclass(frozen=True)
class TopicWithCount(Topic):
    book_count: int


class TopicRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def get_or_create(self, name: str, created_by: str) -> Topic:
        """Reuse the topic whose key matches `name`, else create it with `name` as typed."""
        name = clean_topic_name(name)
        key = topic_key(name)
        await self.db.execute(
            "INSERT INTO topics(id, name, name_key, created_by, created_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(name_key) DO NOTHING",
            (new_id(), name, key, created_by, now_iso()),
        )
        topic = row_to(Topic, await self.db.fetchone("SELECT id, name FROM topics WHERE name_key=?", (key,)))
        assert topic is not None
        return topic

    async def list_in_use(self) -> list[TopicWithCount]:
        """Topics that currently hold at least one book; empty topics stay hidden until reused."""
        rows = await self.db.fetchall(
            "SELECT t.id, t.name, COUNT(b.id) AS book_count FROM topics t JOIN books b ON b.topic_id = t.id"
            " GROUP BY t.id"
        )
        return sorted(rows_to(TopicWithCount, rows), key=lambda t: vietnamese_sort_key(t.name))
